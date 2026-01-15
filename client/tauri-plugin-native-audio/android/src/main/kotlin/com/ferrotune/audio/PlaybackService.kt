package com.ferrotune.audio

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.plugin.JSObject
import coil.ImageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * MediaSessionService for handling audio playback.
 * This service enables:
 * - Background playback (screen off, app minimized)
 * - Lock screen controls
 * - Notification controls
 * - Bluetooth/headphone controls
 */
class PlaybackService : MediaSessionService() {

    companion object {
        private const val TAG = "PlaybackService"
        private const val PROGRESS_UPDATE_INTERVAL_MS = 1000L
    }

    private val binder = LocalBinder()
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())

    private var eventEmitter: ((String, JSObject) -> Unit)? = null
    private var currentTrack: TrackInfo? = null
    private var queue: List<TrackInfo> = emptyList()
    private var queueIndex: Int = -1

    private val progressRunnable = object : Runnable {
        override fun run() {
            if (player.isPlaying) {
                emitProgressEvent()
                handler.postDelayed(this, PROGRESS_UPDATE_INTERVAL_MS)
            }
        }
    }

    inner class LocalBinder : Binder() {
        fun getService(): PlaybackService = this@PlaybackService
    }

    override fun onBind(intent: Intent?): IBinder? {
        val binder = super.onBind(intent)
        return binder ?: this.binder
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "PlaybackService created")

        // Create ExoPlayer with audio attributes
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                true // handleAudioFocus
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        // Add player listener
        player.addListener(PlayerListener())

        // Create pending intent for the app
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Create media session
        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(pendingIntent)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession {
        return mediaSession
    }

    override fun onDestroy() {
        Log.d(TAG, "PlaybackService destroyed")
        handler.removeCallbacks(progressRunnable)
        scope.cancel()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    fun setEventEmitter(emitter: (String, JSObject) -> Unit) {
        eventEmitter = emitter
    }

    fun play() {
        Log.d(TAG, "play()")
        player.play()
    }

    fun pause() {
        Log.d(TAG, "pause()")
        player.pause()
    }

    fun stop() {
        Log.d(TAG, "stop()")
        player.stop()
        player.clearMediaItems()
        currentTrack = null
        queue = emptyList()
        queueIndex = -1
        emitStateChange()
    }

    fun seek(positionMs: Long) {
        Log.d(TAG, "seek($positionMs)")
        player.seekTo(positionMs)
    }

    fun setTrack(track: TrackInfo) {
        Log.d(TAG, "setTrack(${track.title}) - url: ${track.url}")
        currentTrack = track
        queueIndex = 0
        queue = listOf(track)

        scope.launch {
            try {
                val mediaItem = createMediaItem(track)
                Log.d(TAG, "setTrack() - MediaItem created, calling player.setMediaItem()")
                player.setMediaItem(mediaItem)
                Log.d(TAG, "setTrack() - calling player.prepare()")
                player.prepare()
                Log.d(TAG, "setTrack() - player prepared, emitting track change")
                emitTrackChange()
            } catch (e: Exception) {
                Log.e(TAG, "setTrack() - Error setting track", e)
                emitError("Failed to set track: ${e.message}", track.id)
            }
        }
    }

    fun setQueue(items: List<TrackInfo>, startIndex: Int) {
        Log.d(TAG, "setQueue(${items.size} items, startIndex=$startIndex)")
        queue = items
        queueIndex = startIndex.coerceIn(0, items.size - 1)
        currentTrack = items.getOrNull(queueIndex)

        scope.launch {
            val mediaItems = items.map { createMediaItem(it) }
            player.setMediaItems(mediaItems, queueIndex, 0)
            player.prepare()
            emitTrackChange()
        }
    }

    fun nextTrack() {
        Log.d(TAG, "nextTrack()")
        if (player.hasNextMediaItem()) {
            player.seekToNextMediaItem()
        }
    }

    fun previousTrack() {
        Log.d(TAG, "previousTrack()")
        // If more than 3 seconds in, restart current track
        if (player.currentPosition > 3000) {
            player.seekTo(0)
        } else if (player.hasPreviousMediaItem()) {
            player.seekToPreviousMediaItem()
        } else {
            player.seekTo(0)
        }
    }

    fun setVolume(volume: Float) {
        Log.d(TAG, "setVolume($volume)")
        player.volume = volume.coerceIn(0f, 1f)
    }

    fun getState(): PlaybackState {
        return PlaybackState(
            status = mapPlaybackState(player.playbackState, player.playWhenReady),
            positionMs = player.currentPosition.coerceAtLeast(0),
            durationMs = player.duration.let { if (it == C.TIME_UNSET) 0 else it },
            volume = player.volume,
            muted = player.volume == 0f,
            track = currentTrack,
            queueIndex = player.currentMediaItemIndex,
            queueLength = queue.size
        )
    }

    private suspend fun createMediaItem(track: TrackInfo): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)

        // Load artwork if available
        if (track.coverArtUrl != null) {
            try {
                val bitmap = loadArtwork(track.coverArtUrl)
                if (bitmap != null) {
                    metadataBuilder.setArtworkData(
                        bitmapToByteArray(bitmap),
                        MediaMetadata.PICTURE_TYPE_FRONT_COVER
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to load artwork", e)
            }
        }

        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(Uri.parse(track.url))
            .setMediaMetadata(metadataBuilder.build())
            .build()
    }

    private suspend fun loadArtwork(url: String): Bitmap? {
        val loader = ImageLoader(this)
        val request = ImageRequest.Builder(this)
            .data(url)
            .size(512, 512)
            .build()

        val result = loader.execute(request)
        return if (result is SuccessResult) {
            (result.drawable as? BitmapDrawable)?.bitmap
        } else {
            null
        }
    }

    private fun bitmapToByteArray(bitmap: Bitmap): ByteArray {
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        return stream.toByteArray()
    }

    private fun mapPlaybackState(state: Int, playWhenReady: Boolean): PlaybackStatus {
        return when (state) {
            Player.STATE_IDLE -> PlaybackStatus.IDLE
            Player.STATE_BUFFERING -> PlaybackStatus.BUFFERING
            Player.STATE_READY -> if (playWhenReady) PlaybackStatus.PLAYING else PlaybackStatus.PAUSED
            Player.STATE_ENDED -> PlaybackStatus.ENDED
            else -> PlaybackStatus.IDLE
        }
    }

    private fun emitStateChange() {
        val state = getState()
        eventEmitter?.invoke(AudioEvents.STATE_CHANGE, JSObject().apply {
            put("state", state.toJSObject())
        })
    }

    private fun emitProgressEvent() {
        val duration = player.duration.let { if (it == C.TIME_UNSET) 0 else it }
        val buffered = player.bufferedPosition

        eventEmitter?.invoke(AudioEvents.PROGRESS, JSObject().apply {
            put("positionMs", player.currentPosition)
            put("durationMs", duration)
            put("bufferedMs", buffered)
        })
    }

    private fun emitTrackChange() {
        eventEmitter?.invoke(AudioEvents.TRACK_CHANGE, JSObject().apply {
            put("track", currentTrack?.toJSObject())
            put("queueIndex", queueIndex)
        })
    }

    private fun emitError(message: String, trackId: String?) {
        eventEmitter?.invoke(AudioEvents.ERROR, JSObject().apply {
            put("message", message)
            if (trackId != null) {
                put("trackId", trackId)
            }
        })
    }

    private inner class PlayerListener : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            Log.d(TAG, "onPlaybackStateChanged: $playbackState")
            emitStateChange()

            // Start/stop progress updates
            if (playbackState == Player.STATE_READY && player.playWhenReady) {
                handler.post(progressRunnable)
            } else {
                handler.removeCallbacks(progressRunnable)
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            Log.d(TAG, "onPlayWhenReadyChanged: $playWhenReady, reason: $reason")
            emitStateChange()

            if (playWhenReady && player.playbackState == Player.STATE_READY) {
                handler.post(progressRunnable)
            } else {
                handler.removeCallbacks(progressRunnable)
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            Log.d(TAG, "onMediaItemTransition: ${mediaItem?.mediaId}, reason: $reason")
            queueIndex = player.currentMediaItemIndex
            currentTrack = queue.getOrNull(queueIndex)
            emitTrackChange()
            emitStateChange()
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e(TAG, "onPlayerError: ${error.message}", error)
            emitError(error.message ?: "Unknown playback error", currentTrack?.id)
            emitStateChange()
        }

        override fun onVolumeChanged(volume: Float) {
            Log.d(TAG, "onVolumeChanged: $volume")
            emitStateChange()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            Log.d(TAG, "onPositionDiscontinuity: ${newPosition.positionMs}, reason: $reason")
            emitProgressEvent()
        }
    }
}
