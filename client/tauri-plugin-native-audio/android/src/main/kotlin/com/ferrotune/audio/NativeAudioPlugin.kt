package com.ferrotune.audio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import android.webkit.WebView
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
internal class SetTrackArgs {
    lateinit var id: String
    lateinit var url: String
    lateinit var title: String
    var artist: String = ""
    var album: String = ""
    var coverArtUrl: String? = null
    var durationMs: Long = 0
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
}

@InvokeArg
internal class SetQueueArgs {
    var items: Array<QueueItem> = emptyArray()
    var startIndex: Int = 0
}

/**
 * Tauri plugin for native audio playback on Android.
 * Uses Media3 (ExoPlayer) with MediaSessionService for background playback.
 */
@TauriPlugin
class NativeAudioPlugin(private val activity: android.app.Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "NativeAudioPlugin"
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var mediaController: MediaController? = null
    private var playbackService: PlaybackService? = null
    private var serviceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            Log.d(TAG, "PlaybackService connected")
            playbackService = (service as PlaybackService.LocalBinder).getService()
            playbackService?.setEventEmitter { event, data ->
                triggerEvent(event, data)
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.d(TAG, "PlaybackService disconnected")
            playbackService = null
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        Log.d(TAG, "NativeAudioPlugin loaded")
        bindPlaybackService()
        connectToMediaSession()
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

    private fun triggerEvent(event: String, data: JSObject) {
        trigger(event, data)
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
                    durationMs = args.durationMs
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
                        durationMs = item.durationMs
                    )
                }

                val service = awaitService()
                if (service == null) {
                    Log.e(TAG, "setQueue() failed: Service not available after timeout")
                    invoke.reject("Service not available - try again")
                    return@launch
                }
                service.setQueue(items, args.startIndex)
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
}
