package com.ferrotune.audio

import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import app.tauri.plugin.JSObject
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

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
        private const val ACTION_TOGGLE_STAR = "com.ferrotune.TOGGLE_STAR"
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
    // Custom session command for starring the current track
    private val starCommand = SessionCommand(ACTION_TOGGLE_STAR, Bundle.EMPTY)
    // Whether the currently playing track is starred (for WearOS button icon)
    private var isCurrentTrackStarred = false

    // LoudnessEnhancer for ReplayGain boost (allows gain > 1.0)
    private var loudnessEnhancer: LoudnessEnhancer? = null

    // Flag: when true, the next setQueue() call will auto-play regardless
    // of the playWhenReady parameter. Set by requestPlayback() from JS.
    private var pendingPlayOnNextQueue = false

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

        // Initialize LoudnessEnhancer for ReplayGain boost
        try {
            loudnessEnhancer = LoudnessEnhancer(player.audioSessionId)
            loudnessEnhancer?.enabled = true
            Log.d(TAG, "LoudnessEnhancer initialized on session ${player.audioSessionId}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize LoudnessEnhancer", e)
        }

        // Use ForwardingSimpleBasePlayer instead of ForwardingPlayer.
        // ForwardingSimpleBasePlayer uses atomic getState() which properly
        // propagates timeline/queue state to all listeners including the
        // MediaSession's internal legacy session stub (used by WearOS).
        @OptIn(UnstableApi::class)
        val forwardingPlayer = object : ForwardingSimpleBasePlayer(player) {
            override fun getState(): State {
                val state = super.getState()
                return state.buildUpon()
                    .setAvailableCommands(
                        state.availableCommands.buildUpon()
                            .add(COMMAND_SEEK_TO_NEXT)
                            .add(COMMAND_SEEK_TO_PREVIOUS)
                            .add(COMMAND_GET_TIMELINE)
                            .add(COMMAND_GET_CURRENT_MEDIA_ITEM)
                            .add(COMMAND_SET_SHUFFLE_MODE)
                            .add(COMMAND_SET_REPEAT_MODE)
                            .build()
                    )
                    .build()
            }

            override fun handleSeek(
                mediaItemIndex: Int,
                positionMs: Long,
                @Player.Command seekCommand: Int
            ): ListenableFuture<*> {
                when (seekCommand) {
                    COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
                        if (player.hasNextMediaItem()) {
                            player.seekToNextMediaItem()
                        } else {
                            onSkipNext?.invoke()
                        }
                        return Futures.immediateVoidFuture()
                    }
                    COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
                        if (player.currentPosition > 3000) {
                            player.seekTo(0)
                        } else if (player.hasPreviousMediaItem()) {
                            player.seekToPreviousMediaItem()
                        } else {
                            onSkipPrevious?.invoke()
                        }
                        return Futures.immediateVoidFuture()
                    }
                    else -> return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
                }
            }

            override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
                player.shuffleModeEnabled = shuffleModeEnabled
                return Futures.immediateVoidFuture()
            }

            override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
                player.repeatMode = repeatMode
                return Futures.immediateVoidFuture()
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
        @OptIn(UnstableApi::class)
        mediaSession = MediaSession.Builder(this, forwardingPlayer)
            .setSessionActivity(pendingIntent)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo
                ): MediaSession.ConnectionResult {
                    Log.d(TAG, "Controller connected: ${controller.packageName}")
                    // Accept all connections with full player commands and our
                    // custom session commands so external controllers (WearOS,
                    // Android Auto) can see the queue and use custom actions.
                    val sessionCommands = SessionCommands.Builder()
                        .add(starCommand)
                        .build()
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailablePlayerCommands(
                            MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
                        )
                        .setAvailableSessionCommands(sessionCommands)
                        .build()
                }

                override fun onCustomCommand(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    customCommand: SessionCommand,
                    args: Bundle
                ): ListenableFuture<SessionResult> {
                    if (customCommand.customAction == ACTION_TOGGLE_STAR) {
                        Log.d(TAG, "Toggle star from external controller for track: ${currentTrack?.id}")
                        currentTrack?.id?.let { trackId ->
                            eventEmitter?.invoke(AudioEvents.TOGGLE_STAR, JSObject().apply {
                                put("trackId", trackId)
                                put("isStarred", isCurrentTrackStarred)
                            })
                        }
                        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                    }
                    return super.onCustomCommand(session, controller, customCommand, args)
                }
            })
            .build()

        updateMediaButtonPreferences()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession {
        return mediaSession
    }

    override fun onDestroy() {
        Log.d(TAG, "PlaybackService destroyed")
        handler.removeCallbacks(progressRunnable)
        handler.removeCallbacks(endedTimeoutRunnable)
        loudnessEnhancer?.release()
        loudnessEnhancer = null
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

    /**
     * Request that the next setQueue() call auto-starts playback.
     * This is called from JS atom writes (outside React effects) to ensure
     * the play decision is made synchronously with the user action.
     */
    fun requestPlayback() {
        Log.d(TAG, "requestPlayback() - will auto-play on next setQueue")
        pendingPlayOnNextQueue = true
    }

    fun setQueue(items: List<TrackInfo>, startIndex: Int, offset: Int = 0, startPositionMs: Long = 0, playWhenReady: Boolean = false) {
        // Consume the pending play flag: if requestPlayback() was called,
        // override playWhenReady to true regardless of what JS passed.
        val shouldPlay = playWhenReady || pendingPlayOnNextQueue
        pendingPlayOnNextQueue = false
        Log.d(TAG, "setQueue(${items.size} items, startIndex=$startIndex, offset=$offset, startPositionMs=$startPositionMs, playWhenReady=$playWhenReady, pendingPlay->shouldPlay=$shouldPlay)")
        handler.removeCallbacks(endedTimeoutRunnable)
        queue = items
        queueOffset = offset
        queueIndex = offset + startIndex.coerceIn(0, items.size - 1)
        currentTrack = items.getOrNull(startIndex.coerceIn(0, items.size - 1))

        applyTrackReplayGain(currentTrack)

        val mediaItems = items.map { createMediaItem(it) }
        // Set playWhenReady BEFORE setMediaItems to prevent ExoPlayer from
        // auto-starting with the old playWhenReady value during media transition
        player.playWhenReady = shouldPlay
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
        updateMediaButtonPreferences()
    }

    fun updateStarredState(starred: Boolean) {
        Log.d(TAG, "updateStarredState($starred)")
        isCurrentTrackStarred = starred
        updateMediaButtonPreferences()
    }

    @OptIn(UnstableApi::class)
    private fun updateMediaButtonPreferences() {
        if (!::mediaSession.isInitialized) return

        val starIcon = if (isCurrentTrackStarred)
            CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED
        val starButton = CommandButton.Builder(starIcon)
            .setSessionCommand(starCommand)
            .setDisplayName(if (isCurrentTrackStarred) "Unstar" else "Star")
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build()

        val shuffleIcon = if (player.shuffleModeEnabled)
            CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF
        val shuffleButton = CommandButton.Builder(shuffleIcon)
            .setPlayerCommand(Player.COMMAND_SET_SHUFFLE_MODE)
            .setDisplayName("Shuffle")
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build()

        val repeatIcon = when (player.repeatMode) {
            Player.REPEAT_MODE_ONE -> CommandButton.ICON_REPEAT_ONE
            Player.REPEAT_MODE_ALL -> CommandButton.ICON_REPEAT_ALL
            else -> CommandButton.ICON_REPEAT_OFF
        }
        val repeatButton = CommandButton.Builder(repeatIcon)
            .setPlayerCommand(Player.COMMAND_SET_REPEAT_MODE)
            .setDisplayName("Repeat")
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build()

        mediaSession.setMediaButtonPreferences(listOf(starButton, shuffleButton, repeatButton))
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

    /**
     * Set ReplayGain boost/attenuation in millibels.
     * Uses Android's LoudnessEnhancer to apply digital gain,
     * which allows boosting volume above the normal 1.0 max.
     */
    fun setReplayGain(gainMb: Int) {
        Log.d(TAG, "setReplayGain($gainMb mB)")
        try {
            loudnessEnhancer?.setTargetGain(gainMb)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set ReplayGain", e)
        }
    }

    private fun applyTrackReplayGain(track: TrackInfo?) {
        val gainDb = track?.replayGainDb
        val gainMb = if (gainDb != null) (gainDb * 100).toInt() else 0
        setReplayGain(gainMb)
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

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            val reasonStr = when (reason) {
                Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED -> "PLAYLIST_CHANGED"
                Player.TIMELINE_CHANGE_REASON_SOURCE_UPDATE -> "SOURCE_UPDATE"
                else -> "UNKNOWN($reason)"
            }
            Log.d(TAG, "onTimelineChanged: windowCount=${timeline.windowCount}, reason=$reasonStr")
        }

        override fun onAvailableCommandsChanged(commands: Player.Commands) {
            Log.d(TAG, "onAvailableCommandsChanged: " +
                "GET_TIMELINE=${commands.contains(Player.COMMAND_GET_TIMELINE)}, " +
                "SEEK_TO_NEXT=${commands.contains(Player.COMMAND_SEEK_TO_NEXT)}, " +
                "SEEK_TO_MEDIA_ITEM=${commands.contains(Player.COMMAND_SEEK_TO_MEDIA_ITEM)}, " +
                "GET_CURRENT_ITEM=${commands.contains(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)}")
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
            applyTrackReplayGain(currentTrack)
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

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            Log.d(TAG, "onShuffleModeEnabledChanged: $shuffleModeEnabled")
            updateMediaButtonPreferences()
            eventEmitter?.invoke(AudioEvents.SHUFFLE_MODE_CHANGED, JSObject().apply {
                put("enabled", shuffleModeEnabled)
            })
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            val mode = when (repeatMode) {
                Player.REPEAT_MODE_ONE -> "one"
                Player.REPEAT_MODE_ALL -> "all"
                else -> "off"
            }
            Log.d(TAG, "onRepeatModeChanged: $mode")
            updateMediaButtonPreferences()
            eventEmitter?.invoke(AudioEvents.REPEAT_MODE_CHANGED, JSObject().apply {
                put("mode", mode)
            })
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
