package com.ferrotune.audio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// Argument classes for command parameter parsing
@InvokeArg
internal class PlayAtIndexArgs {
    var index: Int = 0
}

@InvokeArg
internal class SeekArgs {
    var positionMs: Long = 0
}

@InvokeArg
internal class VolumeArgs {
    var volume: Float = 1.0f
}

@InvokeArg
internal class ReplayGainArgs {
    var gainMb: Int = 0
}

@InvokeArg
internal class UpdateStarredStateArgs {
    var starred: Boolean = false
}

@InvokeArg
internal class SetRepeatModeArgs {
    var mode: String = "off"
}

@InvokeArg
internal class InitSessionArgs {
    lateinit var serverUrl: String
    lateinit var username: String
    var sessionToken: String? = null
    var sessionExpiresAt: String? = null
    var sessionId: String? = null
    var clientId: String? = null
}

@InvokeArg
internal class UpdateSettingsArgs {
    var replayGainMode: String = "none"
    var replayGainOffset: Float = 0f
    var scrobbleThreshold: Float = 0.5f
    var transcodingEnabled: Boolean = false
    var transcodingBitrate: Int = 192
}

@InvokeArg
internal class StartPlaybackArgs {
    var totalCount: Int = 0
    var currentIndex: Int = 0
    var isShuffled: Boolean = false
    var repeatMode: String = "off"
    var playWhenReady: Boolean = true
    var startPositionMs: Long = 0
    var sessionId: String? = null
    var sourceType: String? = null
    var sourceId: String? = null
}

@InvokeArg
internal class ToggleShuffleArgs {
    var enabled: Boolean = false
}

@InvokeArg
internal class InvalidateQueueArgs {
    var playWhenReady: Boolean? = null
}

@InvokeArg
internal class SoftInvalidateQueueArgs {
    var totalCount: Int = 0
}

@InvokeArg
internal class DebugLogArgs {
    var message: String = ""
}

@InvokeArg
internal class LoadCastMediaQueueItemArgs {
    lateinit var url: String
    var contentType: String = "audio/mpeg"
    lateinit var songId: String
    lateinit var title: String
    lateinit var artist: String
    var album: String? = null
    var coverArtUrl: String? = null
    var durationMs: Long = 0
    var position: Int = 0
}

@InvokeArg
internal class LoadCastMediaArgs {
    lateinit var url: String
    var contentType: String = "audio/mpeg"
    lateinit var songId: String
    lateinit var title: String
    lateinit var artist: String
    var album: String? = null
    var coverArtUrl: String? = null
    var durationMs: Long = 0
    var startTimeMs: Long = 0
    var currentIndex: Int = 0
    var repeatMode: String = "off"
    var queueItems: Array<LoadCastMediaQueueItemArgs>? = null
}

@InvokeArg
internal class CastSeekArgs {
    var positionMs: Long = 0
}

@InvokeArg
internal class CastVolumeArgs {
    var volume: Float = 1.0f
    var muted: Boolean = false
}

@InvokeArg
internal class EnqueueDownloadArgs {
    lateinit var songId: String
    lateinit var format: String // "opus" | "original"
    var maxBitRate: Int = 0 // 0 → null (no maxBitRate param sent)
}

@InvokeArg
internal class RemoveDownloadArgs {
    lateinit var songId: String
}

@InvokeArg
internal class SetWifiOnlyArgs {
    var wifiOnly: Boolean = true
}

/**
 * Tauri plugin for native audio playback on Android.
 * Uses Media3 (ExoPlayer) with MediaSessionService for background playback.
 */
@TauriPlugin
class NativeAudioPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "NativeAudioPlugin"
        private const val NATIVE_APP_RESUME_EVENT = "ferrotune:native-app-resume"
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val pluginInstanceId = UUID.randomUUID().toString()
    private var playbackService: PlaybackService? = null
    private var serviceBound = false
    private var webViewRef: WebView? = null
    private var lastSessionConfig: SessionConfig? = null
    private var lastPlaybackSettings: PlaybackSettings? = null
    private var nativeCastManager: NativeCastManager? = null
    private var safeAreaTop: Float = 0f
    private var safeAreaBottom: Float = 0f
    @Volatile private var webViewInForeground: Boolean = true
    @Volatile private var cleanedUp: Boolean = false
    private val bridgeOwnerToken = Any()

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            if (cleanedUp) {
                Log.w(TAG, "Ignoring PlaybackService connection after plugin cleanup")
                return
            }
            Log.d(TAG, "PlaybackService connected")
            NativeAudioLogger.debug(TAG, "service_connected", "PlaybackService connected")
            val connectedService = (service as PlaybackService.LocalBinder).getService()
            playbackService = connectedService
            connectedService.setEventEmitter(bridgeOwnerToken) { event, data ->
                triggerEvent(event, data)
            }
            // Mirror the same event channel into the offline DownloadManager
            // singleton so download state changes flow to JS over the
            // existing native-audio event bridge.
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.setEventEmitter(bridgeOwnerToken) { event, data ->
                triggerEvent(event, data)
            }
            lastSessionConfig?.let { config ->
                Log.d(TAG, "Re-applying cached session config to PlaybackService")
                connectedService.initSession(config)
                DownloadManagerHolder.setSessionConfig(config)
            }
            lastPlaybackSettings?.let { settings ->
                connectedService.updateSettings(settings)
            }
            if (webViewInForeground) {
                emitCurrentPlaybackSnapshot()
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.d(TAG, "PlaybackService disconnected")
            NativeAudioLogger.warn(TAG, "service_disconnected", "PlaybackService disconnected")
            playbackService = null
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        NativeAudioLogger.initialize(activity.applicationContext)
        Log.d(TAG, "NativeAudioPlugin loaded")
        NativeAudioLogger.debug(
            TAG,
            "plugin_loaded",
            "NativeAudioPlugin loaded",
            mapOf("pluginInstanceId" to pluginInstanceId),
        )
        webViewRef = webView
        // Allow mixed content: the WebView loads from https://tauri.localhost but
        // API requests go to the user's server over plain HTTP. Without this,
        // Android's default MIXED_CONTENT_NEVER_ALLOW silently blocks all fetch()
        // calls from the JS frontend to the backend server.
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        // Disable overscroll glow/bounce effect on the WebView
        webView.overScrollMode = android.view.View.OVER_SCROLL_NEVER
        injectSafeAreaInsets(webView)
        nativeCastManager = NativeCastManager(activity) { event, data ->
            triggerEvent(event, data)
        }
        nativeCastManager?.initialize()
        // Initialize the offline DownloadManager singleton eagerly so that
        // resume-from-previous-session downloads can start as soon as the
        // session token is pushed via initSession.
        DownloadManagerHolder.initialize(activity.applicationContext)
        DownloadManagerHolder.setEventEmitter(bridgeOwnerToken) { event, data ->
            triggerEvent(event, data)
        }
        bindPlaybackService()

        // Re-apply safe area insets after the page loads.
        // The initial injection from onApplyWindowInsetsListener fires before
        // the WebView navigates to the app URL, so the CSS variables are lost.
        val handler = Handler(Looper.getMainLooper())
        handler.postDelayed({ applySafeAreaInsets(webView) }, 1000)
        handler.postDelayed({ applySafeAreaInsets(webView) }, 3000)
    }

    /**
     * Inject safe area insets as CSS variables so the web UI can add
     * padding for the status bar / navigation bar in edge-to-edge mode.
     */
    private fun injectSafeAreaInsets(webView: WebView) {
        val rootView = activity.window.decorView
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val topPx = systemBars.top
            val bottomPx = systemBars.bottom
            // Convert px to CSS-friendly dp-ish values using the display density
            val density = activity.resources.displayMetrics.density
            val newTop = topPx / density
            val newBottom = bottomPx / density
            // Only call evaluateJavascript when values actually change.
            // The soft keyboard triggers onApplyWindowInsets repeatedly, and
            // evaluateJavascript can disrupt WebView input focus on Android.
            if (newTop != safeAreaTop || newBottom != safeAreaBottom) {
                safeAreaTop = newTop
                safeAreaBottom = newBottom
                Log.d(TAG, "Safe area insets: top=${safeAreaTop}dp, bottom=${safeAreaBottom}dp")
                applySafeAreaInsets(webView)
            }
            // Let the default handling continue
            ViewCompat.onApplyWindowInsets(view, insets)
        }
    }

    /**
     * Apply stored safe area inset values as CSS custom properties.
     */
    private fun applySafeAreaInsets(webView: WebView) {
        webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--safe-area-top', '${safeAreaTop}px');" +
            "document.documentElement.style.setProperty('--safe-area-bottom', '${safeAreaBottom}px');",
            null
        )
    }

    /**
     * Force a WebView redraw after resume/config changes so Android does not
     * wait for the next touch gesture before recompositing blurred layers.
     */
    private fun refreshWebView(dispatchResumeEvent: Boolean) {
        val webView = webViewRef ?: return

        webView.post {
            applySafeAreaInsets(webView)
            webView.requestLayout()
            webView.invalidate()
            activity.window.decorView.requestLayout()
            activity.window.decorView.invalidate()

            if (dispatchResumeEvent) {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('$NATIVE_APP_RESUME_EVENT'))",
                    null
                )
                webView.postDelayed({
                    webView.requestLayout()
                    webView.invalidate()
                    activity.window.decorView.requestLayout()
                    activity.window.decorView.invalidate()
                }, 32)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        Log.d(TAG, "NativeAudioPlugin onResume")
        webViewInForeground = true
        emitCurrentPlaybackSnapshot()
        nativeCastManager?.refreshState()
        refreshWebView(dispatchResumeEvent = true)
    }

    override fun onPause() {
        super.onPause()
        Log.d(TAG, "NativeAudioPlugin onPause")
        webViewInForeground = false
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        refreshWebView(dispatchResumeEvent = false)
    }

    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }

    private fun cleanup() {
        if (cleanedUp) return
        cleanedUp = true
        Log.d(TAG, "NativeAudioPlugin cleanup")
        NativeAudioLogger.debug(
            TAG,
            "plugin_cleanup",
            "NativeAudioPlugin cleanup",
            mapOf("pluginInstanceId" to pluginInstanceId),
        )
        scope.cancel()
        nativeCastManager?.release()
        nativeCastManager = null
        DownloadManagerHolder.clearEventEmitter(bridgeOwnerToken)
        webViewRef = null
        unbindPlaybackService()
    }

    private fun bindPlaybackService() {
        val intent = Intent(activity, PlaybackService::class.java)
        activity.startService(intent)
        if (!serviceBound) {
            serviceBound = activity.bindService(
                intent,
                serviceConnection,
                Context.BIND_AUTO_CREATE,
            )
            if (!serviceBound) {
                Log.e(TAG, "PlaybackService bind request was rejected")
                NativeAudioLogger.error(
                    TAG,
                    "service_bind_rejected",
                    "PlaybackService bind request was rejected",
                )
            }
        }
    }

    private fun unbindPlaybackService() {
        playbackService?.clearEventEmitter(bridgeOwnerToken)
        playbackService = null
        if (serviceBound) {
            serviceBound = false
            try {
                activity.unbindService(serviceConnection)
            } catch (error: IllegalArgumentException) {
                Log.w(TAG, "PlaybackService was already unbound", error)
            }
        }
    }

    /**
     * Dispatch an event to the WebView via evaluateJavascript.
     * This bypasses Tauri's plugin event system (trigger/addPluginListener)
     * which doesn't reliably deliver events from Android plugins to JS.
     * Instead, we call a global callback function registered by the JS engine.
     *
     * When the WebView is backgrounded, playback snapshots are discarded
     * instead of queued. A single authoritative snapshot is emitted when the
     * Activity resumes.
     */
    private fun triggerEvent(event: String, data: JSObject) {
        if (!WebViewPlaybackEventPolicy.shouldForward(webViewInForeground, event)) {
            return
        }
        val jsonData = data.toString()
        val legacyCallback = if (event == CastEvents.STATE_CHANGED || event == CastEvents.MEDIA_STATUS) {
            ""
        } else {
            "window.__ferrotuneNativeAudio && window.__ferrotuneNativeAudio('$event', $jsonData)"
        }
        webViewRef?.post {
            webViewRef?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('ferrotune:native-audio-event', " +
                    "{ detail: { event: '$event', data: $jsonData } }));" +
                    legacyCallback,
                null
            )
        }
    }

    /** Replace all discarded background transitions with one current snapshot. */
    private fun emitCurrentPlaybackSnapshot() {
        val state = playbackService?.getState() ?: return

        triggerEvent(AudioEvents.TRACK_CHANGE, JSObject().apply {
            put("track", state.track?.toJSObject())
            put("queueIndex", state.queueIndex)
            put("isSnapshot", true)
        })
        triggerEvent(AudioEvents.STATE_CHANGE, JSObject().apply {
            put("state", state.toJSObject())
            put("isSnapshot", true)
        })
        triggerEvent(AudioEvents.PROGRESS, JSObject().apply {
            put("positionMs", state.positionMs)
            put("durationMs", state.durationMs)
            put("bufferedMs", state.positionMs)
            put("isSnapshot", true)
        })
    }

    /**
     * Wait for the PlaybackService to be available with timeout.
     * Returns the service if available within timeout, null otherwise.
     */
    private suspend fun awaitService(timeoutMs: Long = 5000L): PlaybackService? {
        // If service is already available, return immediately
        playbackService?.let { return it }

        bindPlaybackService()

        // Wait for service to connect with polling
        return withTimeoutOrNull(timeoutMs) {
            while (playbackService == null) {
                delay(50)
            }
            playbackService
        }
    }

    @Command
    fun play(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "play() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                Log.d(TAG, "play() - calling service.play()")
                service.play()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in play()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "pause() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.pause()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in pause()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "stop() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.stop()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in stop()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun resetSession(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "resetSession() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                lastSessionConfig = null
                service.resetSession()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in resetSession()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun seek(invoke: Invoke) {
        Log.d(TAG, "seek command received")
        scope.launch {
            try {
                val args = invoke.parseArgs(SeekArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "seek() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.seek(args.positionMs)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in seek()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun getState(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "getState() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                val state = service.getState()
                invoke.resolve(state.toJSObject())
            } catch (e: Exception) {
                Log.e(TAG, "Error in getState()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun setVolume(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(VolumeArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setVolume() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.setVolume(args.volume)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in setVolume()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun setReplayGain(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(ReplayGainArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setReplayGain() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.setReplayGain(args.gainMb)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in setReplayGain()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun nextTrack(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "nextTrack() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.nextTrack()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in nextTrack()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun playAtIndex(invoke: Invoke) {
        val args = invoke.parseArgs(PlayAtIndexArgs::class.java)
        scope.launch {
            try {
                Log.d(TAG, "playAtIndex() command received: index=${args.index}")
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "playAtIndex() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                Log.d(TAG, "playAtIndex() - calling service.playAtIndex(${args.index})")
                service.playAtIndex(args.index)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in playAtIndex()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun getSafeAreaInsets(invoke: Invoke) {
        invoke.resolve(JSObject().apply {
            put("top", safeAreaTop.toDouble())
            put("bottom", safeAreaBottom.toDouble())
        })
    }

    @Command
    fun previousTrack(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "previousTrack() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.previousTrack()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in previousTrack()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun setRepeatMode(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(SetRepeatModeArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setRepeatMode() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.setRepeatMode(args.mode)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in setRepeatMode()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun updateStarredState(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(UpdateStarredStateArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "updateStarredState() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.updateStarredState(args.starred)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in updateStarredState()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun initSession(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(InitSessionArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "initSession() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                val config = SessionConfig(
                    serverUrl = args.serverUrl,
                    username = args.username,
                    sessionToken = args.sessionToken,
                    sessionExpiresAt = args.sessionExpiresAt,
                    sessionId = args.sessionId,
                    clientId = args.clientId
                )
                lastSessionConfig = config
                NativeAudioLogger.info(
                    TAG,
                    "init_session",
                    "Native session initialized from JS",
                    mapOf(
                        "serverUrl" to args.serverUrl,
                        "username" to args.username,
                        "hasSessionToken" to (args.sessionToken != null),
                        "hasSessionExpiresAt" to (args.sessionExpiresAt != null),
                        "sessionId" to args.sessionId,
                        "clientId" to args.clientId,
                    ),
                )
                service.initSession(config)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in initSession()", e)
                NativeAudioLogger.error(TAG, "init_session_failed", "Error in initSession()", throwable = e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun updateSettings(invoke: Invoke) {
        Log.d(TAG, "updateSettings command received, raw args: ${invoke.getRawArgs()}")
        scope.launch {
            try {
                val args = invoke.parseArgs(UpdateSettingsArgs::class.java)
                Log.d(TAG, "updateSettings parsed: mode=${args.replayGainMode}, offset=${args.replayGainOffset}, transcoding=${args.transcodingEnabled}")
                val settings = PlaybackSettings(
                    replayGainMode = args.replayGainMode,
                    replayGainOffset = args.replayGainOffset,
                    scrobbleThreshold = args.scrobbleThreshold,
                    transcodingEnabled = args.transcodingEnabled,
                    transcodingBitrate = args.transcodingBitrate
                )
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "updateSettings() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                lastPlaybackSettings = settings
                service.updateSettings(settings)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in updateSettings()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun startPlayback(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(StartPlaybackArgs::class.java)
                Log.d(
                    TAG,
                    "startPlayback() command received: total=${args.totalCount}, index=${args.currentIndex}, play=${args.playWhenReady}"
                )
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "startPlayback() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.startPlayback(
                    totalCount = args.totalCount,
                    currentIndex = args.currentIndex,
                    isShuffled = args.isShuffled,
                    repeatMode = args.repeatMode,
                    playWhenReady = args.playWhenReady,
                    startPositionMs = args.startPositionMs,
                    sessionId = args.sessionId,
                    sourceType = args.sourceType,
                    sourceId = args.sourceId
                )
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in startPlayback()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun startOfflinePlayback(invoke: Invoke) {
        scope.launch {
            try {
                val root = JSONObject(invoke.getRawArgs())
                val response = parseOfflineQueueResponse(root)
                val playWhenReady = root.optBoolean("playWhenReady", true)
                val startPositionMs = root.optLong("startPositionMs", response.positionMs)
                val sessionId = nullableString(root, "sessionId")
                val sourceType = nullableString(root, "sourceType") ?: response.sourceType
                val sourceId = nullableString(root, "sourceId") ?: response.sourceId
                Log.d(
                    TAG,
                    "startOfflinePlayback() command received: total=${response.totalCount}, index=${response.currentIndex}, play=$playWhenReady"
                )
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "startOfflinePlayback() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.startOfflinePlayback(
                    response = response.copy(sourceType = sourceType, sourceId = sourceId),
                    playWhenReady = playWhenReady,
                    startPositionMs = startPositionMs,
                    sessionId = sessionId,
                    sourceType = sourceType,
                    sourceId = sourceId,
                )
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in startOfflinePlayback()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun invalidateQueue(invoke: Invoke) {
        val args = invoke.parseArgs(InvalidateQueueArgs::class.java)
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "invalidateQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.invalidateQueue(args.playWhenReady)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in invalidateQueue()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun softInvalidateQueue(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(SoftInvalidateQueueArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "softInvalidateQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.softInvalidateQueue(args.totalCount)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in softInvalidateQueue()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun toggleShuffle(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(ToggleShuffleArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "toggleShuffle() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.autonomousToggleShuffle(args.enabled).await()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in toggleShuffle()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun debugLog(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DebugLogArgs::class.java)
            Log.d(TAG, "[JS] ${args.message}")
            NativeAudioLogger.debug(TAG, "js_debug_log", "[JS] ${args.message}")
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in debugLog()", e)
            NativeAudioLogger.error(TAG, "js_debug_log_failed", "Error in debugLog()", throwable = e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun getCastState(invoke: Invoke) {
        try {
            invoke.resolve(nativeCastManager?.getState() ?: JSObject().apply {
                put("state", "unavailable")
                put("deviceName", null)
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in getCastState()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun requestCastSession(invoke: Invoke) {
        try {
            nativeCastManager?.requestSession()
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in requestCastSession()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun stopCastSession(invoke: Invoke) {
        try {
            nativeCastManager?.stopSession()
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in stopCastSession()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun loadCastMedia(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(LoadCastMediaArgs::class.java)
            nativeCastManager?.loadMedia(
                args,
                onSuccess = { invoke.resolve() },
                onError = { message -> invoke.reject(message) },
            ) ?: invoke.reject("Native Cast manager is not available")
        } catch (e: Exception) {
            Log.e(TAG, "Error in loadCastMedia()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun playCastMedia(invoke: Invoke) {
        try {
            nativeCastManager?.play()
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in playCastMedia()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun pauseCastMedia(invoke: Invoke) {
        try {
            nativeCastManager?.pause()
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in pauseCastMedia()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun stopCastMedia(invoke: Invoke) {
        try {
            nativeCastManager?.stopMedia()
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in stopCastMedia()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun seekCastMedia(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CastSeekArgs::class.java)
            nativeCastManager?.seek(args.positionMs)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in seekCastMedia()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun setCastVolume(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CastVolumeArgs::class.java)
            nativeCastManager?.setVolume(args.volume, args.muted)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in setCastVolume()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun getCastMediaStatus(invoke: Invoke) {
        try {
            invoke.resolve(nativeCastManager?.getMediaStatus() ?: JSObject())
        } catch (e: Exception) {
            Log.e(TAG, "Error in getCastMediaStatus()", e)
            invoke.reject(e.message)
        }
    }

    private fun parseOfflineQueueResponse(root: JSONObject): GetQueueResponse {
        val responseJson = root.getJSONObject("response")
        val windowJson = responseJson.getJSONObject("window")
        val songsArray = windowJson.getJSONArray("songs")
        val songs = mutableListOf<QueueWindowEntry>()

        for (i in 0 until songsArray.length()) {
            val entry = songsArray.getJSONObject(i)
            songs.add(
                QueueWindowEntry(
                    entryId = entry.getString("entryId"),
                    position = entry.getInt("position"),
                    song = parseOfflineQueueSong(entry.getJSONObject("song")),
                )
            )
        }

        val sourceJson = responseJson.optJSONObject("source")
        return GetQueueResponse(
            sourceType = nullableString(root, "sourceType")
                ?: sourceJson?.let { nullableString(it, "type") },
            sourceId = nullableString(root, "sourceId")
                ?: sourceJson?.let { nullableString(it, "id") },
            totalCount = responseJson.getInt("totalCount"),
            currentIndex = responseJson.getInt("currentIndex"),
            positionMs = responseJson.optLong("positionMs", 0),
            isShuffled = responseJson.optBoolean("isShuffled", false),
            repeatMode = responseJson.optString("repeatMode", "off"),
            window = QueueWindow(
                offset = windowJson.optInt("offset", 0),
                songs = songs,
            ),
        )
    }

    private fun parseOfflineQueueSong(json: JSONObject): QueueSong {
        return QueueSong(
            id = json.getString("id"),
            title = nullableString(json, "title") ?: "Unknown",
            artist = nullableString(json, "artist") ?: "Unknown Artist",
            album = nullableString(json, "album") ?: "Unknown Album",
            coverArt = nullableString(json, "coverArt"),
            coverArtData = nullableString(json, "coverArtData"),
            duration = json.optInt("duration", 0),
            computedReplayGainTrackGain = nullableFloat(json, "computedReplayGainTrackGain"),
            originalReplayGainTrackGain = nullableFloat(json, "originalReplayGainTrackGain"),
        )
    }

    private fun nullableString(json: JSONObject, key: String): String? {
        if (!json.has(key) || json.isNull(key)) return null
        return json.optString(key).takeIf { it.isNotBlank() }
    }

    private fun nullableFloat(json: JSONObject, key: String): Float? {
        if (!json.has(key) || json.isNull(key)) return null
        return json.optDouble(key).toFloat()
    }

    // === Offline download commands ===
    // These delegate to the DownloadManagerHolder singleton (initialized in
    // load()) which owns the DownloadManager. The DownloadService itself is
    // started on demand by DownloadService.sendAddDownload(...).

    @Command
    fun enqueueDownload(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(EnqueueDownloadArgs::class.java)
            val maxBitRate: Int? = args.maxBitRate.takeIf { it > 0 }
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.enqueueDownload(
                activity.applicationContext,
                args.songId,
                args.format,
                maxBitRate,
            )
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in enqueueDownload()", e)
            NativeAudioLogger.error(TAG, "enqueue_download_failed", "Error in enqueueDownload()", throwable = e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun removeDownload(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RemoveDownloadArgs::class.java)
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.cancelDownload(activity.applicationContext, args.songId)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in removeDownload()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun removeAllDownloads(invoke: Invoke) {
        try {
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.removeAll(activity.applicationContext)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in removeAllDownloads()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun pauseDownloads(invoke: Invoke) {
        try {
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.pauseAll(activity.applicationContext)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in pauseDownloads()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun resumeDownloads(invoke: Invoke) {
        try {
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.resumeAll(activity.applicationContext)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in resumeDownloads()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun getDownloads(invoke: Invoke) {
        try {
            DownloadManagerHolder.initialize(activity.applicationContext)
            val snapshot = DownloadManagerHolder.snapshot()
            val arr = app.tauri.plugin.JSArray()
            snapshot.forEach { arr.put(it.toJSObject()) }
            invoke.resolve(JSObject().apply { put("downloads", arr) })
        } catch (e: Exception) {
            Log.e(TAG, "Error in getDownloads()", e)
            invoke.reject(e.message)
        }
    }

    @Command
    fun setDownloadWifiOnly(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SetWifiOnlyArgs::class.java)
            DownloadManagerHolder.initialize(activity.applicationContext)
            DownloadManagerHolder.setWifiOnly(args.wifiOnly)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in setDownloadWifiOnly()", e)
            invoke.reject(e.message)
        }
    }
}
