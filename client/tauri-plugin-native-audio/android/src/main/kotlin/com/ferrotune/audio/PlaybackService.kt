package com.ferrotune.audio

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.plugin.JSObject

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
    private val handler = Handler(Looper.getMainLooper())

    private var eventEmitter: ((String, JSObject) -> Unit)? = null
    private var currentTrack: TrackInfo? = null
    private var queue: List<TrackInfo> = emptyList()
    private var queueIndex: Int = -1
    // Offset of the first item in ExoPlayer's queue relative to the server queue
    private var queueOffset: Int = 0
    // Callback for skip prev/next from notification (delegated to web-side queue)
    private var onSkipPrevious: (() -> Unit)? = null
    private var onSkipNext: (() -> Unit)? = null
    // Volume saved during track transitions (muted to prevent old track audio bleed)
    private var transitionSavedVolume: Float? = null

    // Timeout to stop service if JS side doesn't advance after track ends
    private val endedTimeoutRunnable = Runnable {
        Log.d(TAG, "Track ended timeout - stopping service")
        if (player.playbackState == Player.STATE_ENDED) {
            stopSelf()
        }
    }

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

        // Create a ForwardingPlayer that exposes prev/next commands.
        // When ExoPlayer has adjacent items in its queue, use native skip for
        // instant gapless transition. Only fall back to JS-side queue management
        // at the edges of the loaded window.
        val forwardingPlayer = object : ForwardingPlayer(player) {
            override fun getAvailableCommands(): Player.Commands {
                return super.getAvailableCommands().buildUpon()
                    .add(COMMAND_SEEK_TO_NEXT)
                    .add(COMMAND_SEEK_TO_PREVIOUS)
                    .build()
            }

            override fun isCommandAvailable(command: Int): Boolean {
                if (command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_PREVIOUS) return true
                return super.isCommandAvailable(command)
            }

            override fun seekToNext() {
                if (wrappedPlayer.hasNextMediaItem()) {
                    wrappedPlayer.seekToNextMediaItem()
                } else {
                    onSkipNext?.invoke()
                }
            }

            override fun seekToPrevious() {
                if (wrappedPlayer.currentPosition > 3000) {
                    wrappedPlayer.seekTo(0)
                } else if (wrappedPlayer.hasPreviousMediaItem()) {
                    wrappedPlayer.seekToPreviousMediaItem()
                } else {
                    onSkipPrevious?.invoke()
                }
            }
        }

        // Create pending intent for the app
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Create media session using ForwardingPlayer for notification controls
        mediaSession = MediaSession.Builder(this, forwardingPlayer)
            .setSessionActivity(pendingIntent)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession {
        return mediaSession
    }

    override fun onDestroy() {
        Log.d(TAG, "PlaybackService destroyed")
        handler.removeCallbacks(progressRunnable)
        handler.removeCallbacks(endedTimeoutRunnable)
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    fun setEventEmitter(emitter: (String, JSObject) -> Unit) {
        eventEmitter = emitter
    }

    fun setSkipCallbacks(onPrevious: () -> Unit, onNext: () -> Unit) {
        onSkipPrevious = onPrevious
        onSkipNext = onNext
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Use playWhenReady instead of isPlaying. When a track naturally ends
        // (STATE_ENDED), isPlaying is false but playWhenReady is still true.
        // This gives the JS side time to advance to the next track.
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        // Keep the service in foreground when a track ends naturally
        // (playWhenReady still true) to prevent the system from killing
        // the service before the JS side can advance to the next track.
        val keepForeground = startInForegroundRequired ||
            (player.playWhenReady && player.playbackState == Player.STATE_ENDED)
        super.onUpdateNotification(session, keepForeground)
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
        handler.removeCallbacks(endedTimeoutRunnable)

        currentTrack = track
        queueIndex = 0
        queue = listOf(track)

        // Mute the player during the transition to prevent briefly hearing
        // the old track. We avoid stop()/setMediaItem() because those enter
        // STATE_IDLE which dismisses the media notification.
        // Only save the original volume on the first transition call
        // (handles rapid successive setTrack calls correctly).
        if (transitionSavedVolume == null) {
            transitionSavedVolume = player.volume
        }
        player.volume = 0f

        try {
            val mediaItem = createMediaItem(track)
            Log.d(TAG, "setTrack() - MediaItem created")

            if (player.mediaItemCount > 0 && player.playbackState != Player.STATE_IDLE) {
                // Swap tracks without going through STATE_IDLE:
                // add new item, jump to it, remove old item.
                // This keeps the media session alive and the notification visible.
                player.addMediaItem(mediaItem)
                player.seekToNextMediaItem()
                player.removeMediaItem(0)
                Log.d(TAG, "setTrack() - swapped media item in-place")
            } else {
                // First track or player was idle — standard path
                player.setMediaItem(mediaItem)
                player.prepare()
                Log.d(TAG, "setTrack() - set initial media item")
            }

            emitTrackChange()
        } catch (e: Exception) {
            Log.e(TAG, "setTrack() - Error setting track", e)
            // Restore volume on failure
            transitionSavedVolume?.let { savedVol ->
                player.volume = savedVol
                transitionSavedVolume = null
            }
            emitError("Failed to set track: ${e.message}", track.id)
        }
    }

    fun setQueue(items: List<TrackInfo>, startIndex: Int, offset: Int = 0, startPositionMs: Long = 0) {
        Log.d(TAG, "setQueue(${items.size} items, startIndex=$startIndex, offset=$offset, startPositionMs=$startPositionMs)")
        handler.removeCallbacks(endedTimeoutRunnable)
        queue = items
        queueOffset = offset
        queueIndex = offset + startIndex.coerceIn(0, items.size - 1)
        currentTrack = items.getOrNull(startIndex.coerceIn(0, items.size - 1))

        val mediaItems = items.map { createMediaItem(it) }
        player.setMediaItems(mediaItems, startIndex.coerceIn(0, items.size - 1), startPositionMs)
        player.prepare()
        emitTrackChange()
    }

    fun appendToQueue(items: List<TrackInfo>) {
        Log.d(TAG, "appendToQueue(${items.size} items)")
        queue = queue + items
        val mediaItems = items.map { createMediaItem(it) }
        player.addMediaItems(mediaItems)
    }

    fun setRepeatMode(mode: String) {
        Log.d(TAG, "setRepeatMode($mode)")
        player.repeatMode = when (mode) {
            "one" -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
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
        val clamped = volume.coerceIn(0f, 1f)
        player.volume = clamped
        // If we're in a transition, update the saved volume too
        // so the correct value is restored when the transition completes
        if (transitionSavedVolume != null) {
            transitionSavedVolume = clamped
        }
    }

    fun getState(): PlaybackState {
        return PlaybackState(
            status = mapPlaybackState(player.playbackState, player.playWhenReady),
            positionMs = player.currentPosition.coerceAtLeast(0),
            durationMs = player.duration.let { if (it == C.TIME_UNSET) 0 else it },
            volume = player.volume,
            muted = player.volume == 0f,
            track = currentTrack,
            queueIndex = queueOffset + player.currentMediaItemIndex,
            queueLength = queue.size
        )
    }

    private fun createMediaItem(track: TrackInfo): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)

        // Use artwork URI instead of embedding raw bitmap data.
        // Embedding bitmaps in MediaMetadata causes TransactionTooLargeException
        // (binder limit ~1MB) when the MediaSession sends player info to controllers.
        // Media3 will load the artwork asynchronously from the URI for notifications.
        if (track.coverArtUrl != null) {
            metadataBuilder.setArtworkUri(Uri.parse(track.coverArtUrl))
        }

        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(Uri.parse(track.url))
            .setMediaMetadata(metadataBuilder.build())
            .build()
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

            // Restore volume after track transition completes
            if (playbackState == Player.STATE_READY) {
                transitionSavedVolume?.let { savedVol ->
                    Log.d(TAG, "Restoring volume after transition: $savedVol")
                    player.volume = savedVol
                    transitionSavedVolume = null
                }
            }

            emitStateChange()

            // Start/stop progress updates
            if (playbackState == Player.STATE_READY && player.playWhenReady) {
                handler.post(progressRunnable)
            } else {
                handler.removeCallbacks(progressRunnable)
            }

            // When a track ends, give the JS side time to advance to the
            // next track. If no new track is set within 60s, stop the service.
            if (playbackState == Player.STATE_ENDED) {
                handler.postDelayed(endedTimeoutRunnable, 60_000)
            } else {
                handler.removeCallbacks(endedTimeoutRunnable)
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
            Log.d(TAG, "onMediaItemTransition: ${mediaItem?.mediaId}, reason: $reason, exoIndex: ${player.currentMediaItemIndex}")
            val exoIndex = player.currentMediaItemIndex
            queueIndex = queueOffset + exoIndex
            currentTrack = queue.getOrNull(exoIndex)
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
