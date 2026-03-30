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
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

// Argument classes for command parameter parsing
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
internal class SetTrackArgs {
    lateinit var id: String
    lateinit var url: String
    lateinit var title: String
    var artist: String = ""
    var album: String = ""
    var coverArtUrl: String? = null
    var durationMs: Long = 0
    var replayGainDb: Float? = null
}

@InvokeArg
internal class QueueItem {
    lateinit var id: String
    lateinit var url: String
    lateinit var title: String
    var artist: String = ""
    var album: String = ""
    var coverArtUrl: String? = null
    var durationMs: Long = 0
    var replayGainDb: Float? = null
}

@InvokeArg
internal class SetQueueArgs {
    var items: Array<QueueItem> = emptyArray()
    var startIndex: Int = 0
    var queueOffset: Int = 0
    var startPositionMs: Long = 0
    var playWhenReady: Boolean = false
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
internal class AppendToQueueArgs {
    var items: Array<QueueItem> = emptyArray()
}

@InvokeArg
internal class InitSessionArgs {
    lateinit var serverUrl: String
    lateinit var username: String
    var password: String? = null
    var apiKey: String? = null
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
internal class StartAutonomousPlaybackArgs {
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
internal class SoftInvalidateQueueArgs {
    var totalCount: Int = 0
}

@InvokeArg
internal class DebugLogArgs {
    var message: String = ""
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
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var mediaController: MediaController? = null
    private var playbackService: PlaybackService? = null
    private var serviceBound = false
    private var webViewRef: WebView? = null
    private var safeAreaTop: Float = 0f
    private var safeAreaBottom: Float = 0f
    @Volatile private var webViewInForeground: Boolean = true

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            Log.d(TAG, "PlaybackService connected")
            playbackService = (service as PlaybackService.LocalBinder).getService()
            playbackService?.setEventEmitter { event, data ->
                triggerEvent(event, data)
            }
            // Wire up skip callbacks so notification prev/next dispatch events to the web side
            playbackService?.setSkipCallbacks(
                onPrevious = {
                    triggerEvent(AudioEvents.SKIP_PREVIOUS, JSObject())
                },
                onNext = {
                    triggerEvent(AudioEvents.SKIP_NEXT, JSObject())
                }
            )
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.d(TAG, "PlaybackService disconnected")
            playbackService = null
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        Log.d(TAG, "NativeAudioPlugin loaded")
        webViewRef = webView
        // Allow mixed content: the WebView loads from https://tauri.localhost but
        // API requests go to the user's server over plain HTTP. Without this,
        // Android's default MIXED_CONTENT_NEVER_ALLOW silently blocks all fetch()
        // calls from the JS frontend to the backend server.
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        // Disable overscroll glow/bounce effect on the WebView
        webView.overScrollMode = android.view.View.OVER_SCROLL_NEVER
        injectSafeAreaInsets(webView)
        bindPlaybackService()
        connectToMediaSession()

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

    // Note: Plugin base class doesn't have onDestroy hook
    // Cleanup is handled when activity/service lifecycle ends
    fun cleanup() {
        Log.d(TAG, "NativeAudioPlugin cleanup")
        scope.cancel()
        releaseMediaController()
        unbindPlaybackService()
    }

    private fun bindPlaybackService() {
        val intent = Intent(activity, PlaybackService::class.java)
        activity.startService(intent)
        activity.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        serviceBound = true
    }

    private fun unbindPlaybackService() {
        if (serviceBound) {
            activity.unbindService(serviceConnection)
            serviceBound = false
        }
    }

    private fun connectToMediaSession() {
        val sessionToken = SessionToken(
            activity,
            ComponentName(activity, PlaybackService::class.java)
        )

        controllerFuture = MediaController.Builder(activity, sessionToken).buildAsync()
        controllerFuture?.addListener({
            try {
                mediaController = controllerFuture?.get()
                Log.d(TAG, "MediaController connected")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to MediaController", e)
            }
        }, MoreExecutors.directExecutor())
    }

    private fun releaseMediaController() {
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        mediaController = null
    }

    /**
     * Dispatch an event to the WebView via evaluateJavascript.
     * This bypasses Tauri's plugin event system (trigger/addPluginListener)
     * which doesn't reliably deliver events from Android plugins to JS.
     * Instead, we call a global callback function registered by the JS engine.
     *
     * When the WebView is backgrounded, high-frequency events (progress, clipping)
     * are skipped since they'd queue up uselessly. The JS resume handler syncs
     * full state from the native service via nativeGetState() on foregrounding.
     */
    private fun triggerEvent(event: String, data: JSObject) {
        if (!webViewInForeground && (event == AudioEvents.PROGRESS || event == AudioEvents.CLIPPING)) {
            return
        }
        val jsonData = data.toString()
        webViewRef?.post {
            webViewRef?.evaluateJavascript(
                "window.__ferrotuneNativeAudio && window.__ferrotuneNativeAudio('$event', $jsonData)",
                null
            )
        }
    }

    /**
     * Wait for the PlaybackService to be available with timeout.
     * Returns the service if available within timeout, null otherwise.
     */
    private suspend fun awaitService(timeoutMs: Long = 5000L): PlaybackService? {
        // If service is already available, return immediately
        playbackService?.let { return it }

        // Wait for service to connect with polling
        return withTimeoutOrNull(timeoutMs) {
            while (playbackService == null) {
                delay(50)
            }
            playbackService
        }
    }

    @Command
    fun requestPlayback(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "requestPlayback() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.requestPlayback()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in requestPlayback()", e)
                invoke.reject(e.message)
            }
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
    fun setTrack(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(SetTrackArgs::class.java)
                Log.d(TAG, "setTrack() called with: id=${args.id}, title=${args.title}, url=${args.url}")
                val track = TrackInfo(
                    id = args.id,
                    url = args.url,
                    title = args.title,
                    artist = args.artist,
                    album = args.album,
                    coverArtUrl = args.coverArtUrl,
                    durationMs = args.durationMs,
                    replayGainDb = args.replayGainDb
                )
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setTrack() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                Log.d(TAG, "setTrack() - calling service.setTrack()")
                service.setTrack(track)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in setTrack()", e)
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
    fun setQueue(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(SetQueueArgs::class.java)
                Log.d(TAG, "setQueue() called with ${args.items.size} items, startIndex=${args.startIndex}")

                val items = args.items.map { item ->
                    TrackInfo(
                        id = item.id,
                        url = item.url,
                        title = item.title,
                        artist = item.artist,
                        album = item.album,
                        coverArtUrl = item.coverArtUrl,
                        durationMs = item.durationMs,
                        replayGainDb = item.replayGainDb
                    )
                }

                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.setQueue(items, args.startIndex, args.queueOffset, args.startPositionMs, args.playWhenReady)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in setQueue()", e)
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
    fun appendToQueue(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(AppendToQueueArgs::class.java)
                Log.d(TAG, "appendToQueue() called with ${args.items.size} items")
                val items = args.items.map { item ->
                    TrackInfo(
                        id = item.id,
                        url = item.url,
                        title = item.title,
                        artist = item.artist,
                        album = item.album,
                        coverArtUrl = item.coverArtUrl,
                        durationMs = item.durationMs,
                        replayGainDb = item.replayGainDb
                    )
                }
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "appendToQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.appendToQueue(items)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in appendToQueue()", e)
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
                service.initSession(SessionConfig(
                    serverUrl = args.serverUrl,
                    username = args.username,
                    password = args.password,
                    apiKey = args.apiKey,
                    sessionId = args.sessionId,
                    clientId = args.clientId
                ))
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in initSession()", e)
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
                service.updateSettings(settings)
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Error in updateSettings()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun startAutonomousPlayback(invoke: Invoke) {
        scope.launch {
            try {
                val args = invoke.parseArgs(StartAutonomousPlaybackArgs::class.java)
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "startAutonomousPlayback() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.startAutonomousPlayback(
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
                Log.e(TAG, "Error in startAutonomousPlayback()", e)
                invoke.reject(e.message)
            }
        }
    }

    @Command
    fun invalidateQueue(invoke: Invoke) {
        scope.launch {
            try {
                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "invalidateQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.invalidateQueue()
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
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "Error in debugLog()", e)
            invoke.reject(e.message)
        }
    }
}
