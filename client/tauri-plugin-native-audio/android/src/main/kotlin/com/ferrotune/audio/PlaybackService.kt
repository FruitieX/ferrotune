package com.ferrotune.audio

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AdPlaybackState
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.SimpleBasePlayer.PeriodData
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import app.tauri.plugin.JSObject
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.pow
import kotlinx.coroutines.CompletableDeferred

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
        // Fetch more songs when this many or fewer remain ahead in ExoPlayer queue
        private const val PREFETCH_THRESHOLD = 5
        // Sync position to server every N milliseconds
        private const val POSITION_SYNC_INTERVAL_MS = 30_000L
        // How many ms before track end to pre-apply next track's ReplayGain.
        // This should be long enough to cover ExoPlayer's gapless pre-decode buffer
        // but short enough that the volume difference on the current track's tail is inaudible.
        private const val REPLAYGAIN_PRE_APPLY_LEAD_MS = 500L
        // Stop the foreground service after this many ms of inactivity (paused)
        private const val INACTIVITY_TIMEOUT_MS = 5L * 60 * 1000
        // Cache size for transcoded audio streams (200 MB)
        private const val STREAM_CACHE_MAX_BYTES = 200L * 1024 * 1024
        // SimpleCache is a singleton — only one instance may exist per cache directory.
        // We keep it in the companion object so it survives service re-creation.
        private var streamCache: SimpleCache? = null
    }

    private val binder = LocalBinder()
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession
    private var sessionPlayer: ForwardingSimpleBasePlayer? = null
    private var invalidateSessionPlayerState: (() -> Unit)? = null
    private val handler = Handler(Looper.getMainLooper())
    // Background executor for API calls (no main thread blocking)
    private val apiExecutor = Executors.newSingleThreadExecutor()

    private var eventEmitter: ((String, JSObject) -> Unit)? = null
    private var currentTrack: TrackInfo? = null
    private var queue: List<TrackInfo> = emptyList()
    private var queueIndex: Int = -1
    // Offset of the first item in ExoPlayer's queue relative to the server queue
    private var queueOffset: Int = 0
    // Callback for skip prev/next from notification (delegated to web-side queue)
    // (Only used in legacy JS-driven mode when autonomousMode is false)
    private var onSkipPrevious: (() -> Unit)? = null
    private var onSkipNext: (() -> Unit)? = null
    // Volume saved during track transitions (muted to prevent old track audio bleed)
    private var transitionSavedVolume: Float? = null
    // Separate user volume and ReplayGain gain, combined via applyVolume()
    private var userVolume: Float = 1f
    private var replayGainLinear: Float = 1f
    // Custom session command for starring the current track
    private val starCommand = SessionCommand(ACTION_TOGGLE_STAR, Bundle.EMPTY)
    // Whether the currently playing track is starred (for WearOS button icon)
    private var isCurrentTrackStarred = false

    // Custom AudioProcessor for ReplayGain (supports boost > 0 dB and clipping detection)
    private val replayGainProcessor = ReplayGainAudioProcessor()

    // Flag: when true, the next setQueue() call will auto-play regardless
    // of the playWhenReady parameter. Set by requestPlayback() from JS.
    private var pendingPlayOnNextQueue = false

    // === Autonomous queue management state ===
    // When true, Kotlin handles queue fetching, skip, repeat, shuffle, and scrobbling
    private var autonomousMode = false
    val apiClient = FerrotuneApiClient()
    private var playbackSettings = PlaybackSettings()
    // Stored reference to update auth headers when session config changes
    @OptIn(UnstableApi::class)
    private var httpDataSourceFactory: DefaultHttpDataSource.Factory? = null
    // Server queue state
    private var serverQueueIndex: Int = 0
    private var serverTotalCount: Int = 0
    private var isShuffled: Boolean = false
    private var repeatMode: String = "off"
    // Queue source info for scrobbling (so "Continue Listening" can show playlists)
    private var queueSourceType: String? = null
    private var queueSourceId: String? = null
    // Range of server positions currently loaded in ExoPlayer
    // e.g. if positions 10-30 are loaded: loadedRangeStart=10, loadedRangeEnd=30
    private var loadedRangeStart: Int = 0
    private var loadedRangeEnd: Int = -1 // exclusive
    // Map from ExoPlayer index to server queue position
    private var exoIndexToServerPosition: MutableList<Int> = mutableListOf()
    // Raw QueueSong data for each ExoPlayer index (for recomputing gain on settings change)
    private var exoIndexToQueueSong: MutableList<QueueSong?> = mutableListOf()
    // Whether a fetch is already in progress (prevent concurrent fetches)
    private var isFetching = false
    // Monotonically increasing counter bumped by invalidateQueue().
    // SSE QueueUpdated skips full-reload when an invalidation is pending
    // (the invalidateQueue path preserves player.currentPosition correctly).
    private var invalidateVersion = 0
    // Scrobble state
    private var accumulatedListenMs: Long = 0
    private var hasScrobbled = false
    private var lastProgressTimestamp: Long = 0
    // Offset (ms) applied when seeking in transcoded streams via seek-by-reload.
    // The server starts the stream at this offset, so ExoPlayer position is relative.
    // Added to player.currentPosition for correct absolute position reporting.
    private var seekTimeOffsetMs: Long = 0
    // True when we've pre-applied the next track's ReplayGain before a gapless transition.
    // Reset on each track change so we only pre-apply once per transition.
    private var hasPreAppliedNextGain = false

    // Track retry count for network errors to prevent infinite loops
    private var networkRetryCount = 0
    private val MAX_NETWORK_RETRIES = 2
    private val NETWORK_RETRY_DELAY_MS = 1500L

    // SSE remote control
    private var sseConnected = false
    private var sseReconnectRunnable: Runnable? = null
    private val SSE_RECONNECT_DELAY_MS = 3000L

    // Timeout to stop service if JS side doesn't advance after track ends
    private val endedTimeoutRunnable = Runnable {
        Log.d(TAG, "Track ended timeout - stopping service")
        if (player.playbackState == Player.STATE_ENDED) {
            stopSelf()
        }
    }

    // Timeout to stop service after extended inactivity (paused)
    private val inactivityTimeoutRunnable = Runnable {
        Log.d(TAG, "Inactivity timeout - stopping service")
        if (!player.isPlaying) {
            stopSelf()
        }
    }

    private val progressRunnable = object : Runnable {
        override fun run() {
            if (player.isPlaying) {
                emitProgressEvent()
                // Track accumulated listen time for scrobbling
                if (autonomousMode) {
                    val now = System.currentTimeMillis()
                    if (lastProgressTimestamp > 0) {
                        accumulatedListenMs += (now - lastProgressTimestamp)
                    }
                    lastProgressTimestamp = now
                    checkScrobble()
                }
                handler.postDelayed(this, PROGRESS_UPDATE_INTERVAL_MS)
            }
        }
    }

    // Periodic position sync to server
    private val positionSyncRunnable = object : Runnable {
        override fun run() {
            if (autonomousMode && player.isPlaying) {
                syncPositionToServer()
                // Also send heartbeat to keep the session alive (JS timer may
                // be suspended when the WebView is backgrounded)
                sendPlaybackStateHeartbeat(true)
                handler.postDelayed(this, POSITION_SYNC_INTERVAL_MS)
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

        // Set up clipping detection callback (posts to main thread for event emission)
        replayGainProcessor.setClippingCallback { peakOverDb ->
            handler.post { emitClippingEvent(peakOverDb) }
        }

        // Create ExoPlayer with ReplayGainAudioProcessor in the audio pipeline
        @OptIn(UnstableApi::class)
        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink {
                Log.i(TAG, "buildAudioSink called: enableFloatOutput=$enableFloatOutput, " +
                    "enableAudioTrackPlaybackParams=$enableAudioTrackPlaybackParams")
                return DefaultAudioSink.Builder(context)
                    .setAudioProcessorChain(
                        DefaultAudioSink.DefaultAudioProcessorChain(replayGainProcessor)
                    )
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .build()
            }
        }

        // Initialize the stream cache (singleton — only one per directory)
        @OptIn(UnstableApi::class)
        if (streamCache == null) {
            val cacheDir = File(cacheDir, "exo-stream-cache")
            val evictor = LeastRecentlyUsedCacheEvictor(STREAM_CACHE_MAX_BYTES)
            val databaseProvider = StandaloneDatabaseProvider(this)
            streamCache = SimpleCache(cacheDir, evictor, databaseProvider)
        }

        // CacheDataSource wraps the default HTTP data source: bytes are written
        // to the local cache as they arrive and served from there on re-reads.
        // This means ExoPlayer can resume from the cache after a network blip
        // without re-requesting already-received data from the server.
        @OptIn(UnstableApi::class)
        httpDataSourceFactory = DefaultHttpDataSource.Factory()

        @OptIn(UnstableApi::class)
        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(streamCache!!)
            .setUpstreamDataSourceFactory(httpDataSourceFactory!!)
            // Allow reading from the cache even while the upstream connection
            // is still open (progressive caching).
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        // Custom load error policy: for transcoded (chunked) streams the server
        // does not support Range requests, so ExoPlayer's default retry (which
        // tries to resume from the last byte) is counter-productive — it would
        // restart from byte 0. Disable source-level retries so errors surface
        // immediately to onPlayerError where we handle them with timeOffset.
        @OptIn(UnstableApi::class)
        val loadErrorPolicy = object : DefaultLoadErrorHandlingPolicy() {
            override fun getMinimumLoadableRetryCount(dataType: Int): Int {
                // When transcoding is active, skip data-source-level retries.
                // The cache covers brief blips; longer outages are handled by
                // onPlayerError's timeOffset retry logic.
                return if (playbackSettings.transcodingEnabled) 0
                    else super.getMinimumLoadableRetryCount(dataType)
            }
        }

        @OptIn(UnstableApi::class)
        val mediaSourceFactory = DefaultMediaSourceFactory(cacheDataSourceFactory)
            .setLoadErrorHandlingPolicy(loadErrorPolicy)

        // Allow ExoPlayer to buffer the full track into the cache in a burst
        // instead of the default ~50 s ceiling. This avoids hammering the
        // network with repeated small fetches and makes brief outages
        // invisible to the user because the audio is already on disk.
        @OptIn(UnstableApi::class)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs  */   DefaultLoadControl.DEFAULT_MIN_BUFFER_MS,
                /* maxBufferMs  */   20 * 60 * 1000,   // 20 minutes — enough for any track
                /* bufferForPlaybackMs */          DefaultLoadControl.DEFAULT_BUFFER_FOR_PLAYBACK_MS,
                /* bufferForPlaybackAfterRebufferMs */ DefaultLoadControl.DEFAULT_BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
            )
            .build()

        player = ExoPlayer.Builder(this, renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
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

        // Use ForwardingSimpleBasePlayer instead of ForwardingPlayer.
        // ForwardingSimpleBasePlayer uses atomic getState() which properly
        // propagates timeline/queue state to all listeners including the
        // MediaSession's internal legacy session stub (used by WearOS).
        @OptIn(UnstableApi::class)
        val forwardingPlayer = object : ForwardingSimpleBasePlayer(player) {
            override fun getState(): State {
                val state = super.getState()
                val offset = this@PlaybackService.seekTimeOffsetMs
                val track = this@PlaybackService.currentTrack
                val builder = state.buildUpon()
                    .setAvailableCommands(
                        state.availableCommands.buildUpon()
                            .add(COMMAND_SEEK_TO_NEXT)
                            .add(COMMAND_SEEK_TO_PREVIOUS)
                            .add(COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                            .add(COMMAND_GET_TIMELINE)
                            .add(COMMAND_GET_CURRENT_MEDIA_ITEM)
                            .add(COMMAND_GET_METADATA)
                            .add(COMMAND_SET_SHUFFLE_MODE)
                            .add(COMMAND_SET_REPEAT_MODE)
                            .build()
                    )
                // Adjust position for seek-by-reload offset so notification shows correct time
                if (offset > 0) {
                    builder.setContentPositionMs { state.contentPositionMsSupplier.get() + offset }
                    builder.setContentBufferedPositionMs { state.contentBufferedPositionMsSupplier.get() + offset }
                }
                // Override playlist items to set correct duration from metadata.
                // For transcoded streams, ExoPlayer reports C.TIME_UNSET for duration
                // which prevents the notification seekbar from being interactive.
                if (track != null && track.durationMs > 0 && state.playlist.isNotEmpty()) {
                    val currentIdx = state.currentMediaItemIndex
                    val durationUs = track.durationMs * 1000L
                    val fixedPlaylist = state.playlist.mapIndexed { idx, item ->
                        if (idx == currentIdx) {
                            item.buildUpon()
                                .setDurationUs(durationUs)
                                // Mark as seekable so the notification shows a
                                // determinate progress bar even for transcoded
                                // streams (we handle seeking via stream reload).
                                .setIsSeekable(true)
                                // Mark as non-placeholder so the notification
                                // doesn't show an indeterminate progress bar
                                // (ExoPlayer can't determine duration from chunked
                                // transcoded streams without Content-Length).
                                .setIsPlaceholder(false)
                                .setPeriods(listOf(
                                    PeriodData.Builder(item.uid)
                                        .setDurationUs(durationUs)
                                        .setIsPlaceholder(false)
                                        .setAdPlaybackState(AdPlaybackState.NONE)
                                        .build()
                                ))
                                .build()
                        } else {
                            item
                        }
                    }
                    builder.setPlaylist(fixedPlaylist)
                }
                return builder.build()
            }

            override fun handleSeek(
                mediaItemIndex: Int,
                positionMs: Long,
                @Player.Command seekCommand: Int
            ): ListenableFuture<*> {
                when (seekCommand) {
                    COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
                        if (autonomousMode) {
                            autonomousSkipNext()
                        } else if (player.hasNextMediaItem()) {
                            player.seekToNextMediaItem()
                        } else {
                            onSkipNext?.invoke()
                        }
                        return Futures.immediateVoidFuture()
                    }
                    COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
                        if (autonomousMode) {
                            autonomousSkipPrevious()
                        } else if (player.currentPosition > 3000) {
                            player.seekTo(0)
                        } else if (player.hasPreviousMediaItem()) {
                            player.seekToPreviousMediaItem()
                        } else {
                            onSkipPrevious?.invoke()
                        }
                        return Futures.immediateVoidFuture()
                    }
                    COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM -> {
                        this@PlaybackService.seek(positionMs)
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

            init {
                this@PlaybackService.invalidateSessionPlayerState = { invalidateState() }
            }
        }
        sessionPlayer = forwardingPlayer

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
        handler.removeCallbacks(inactivityTimeoutRunnable)
        handler.removeCallbacks(positionSyncRunnable)
        handler.removeCallbacks(preApplyGainRunnable)
        sseReconnectRunnable?.let { handler.removeCallbacks(it) }
        apiClient.disconnectSSE()
        replayGainProcessor.setClippingCallback(null)
        apiExecutor.shutdownNow()
        mediaSession.release()
        player.release()
        // Release the stream cache so its file locks are freed.
        // The null-check in onCreate will re-create it if the service restarts.
        streamCache?.release()
        streamCache = null
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
        seekTimeOffsetMs = 0
        queue = emptyList()
        queueIndex = -1
        autonomousMode = false
        queueSourceType = null
        queueSourceId = null
        handler.removeCallbacks(positionSyncRunnable)
        handler.removeCallbacks(preApplyGainRunnable)
        replayGainProcessor.clearPendingGain()
        emitStateChange()
    }

    fun seek(positionMs: Long) {
        Log.d(TAG, "seek($positionMs) transcoding=${playbackSettings.transcodingEnabled}")

        if (playbackSettings.transcodingEnabled && currentTrack != null) {
            // Transcoded streams don't support HTTP Range requests, so we reload
            // the stream with a timeOffset parameter to seek server-side.
            val track = currentTrack!!
            val timeOffsetSeconds = positionMs / 1000
            val newUrl = apiClient.buildStreamUrl(track.id, playbackSettings, timeOffsetSeconds)
            seekTimeOffsetMs = positionMs

            val metadataBuilder = MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist)
                .setAlbumTitle(track.album)
                .setDurationMs(track.durationMs)
            if (track.coverArtUrl != null) {
                metadataBuilder.setArtworkUri(Uri.parse(track.coverArtUrl))
            }

            val newMediaItem = MediaItem.Builder()
                .setMediaId(track.id)
                .setUri(Uri.parse(newUrl))
                .setMediaMetadata(metadataBuilder.build())
                .build()

            val currentIndex = player.currentMediaItemIndex
            val wasPlaying = player.playWhenReady
            player.replaceMediaItem(currentIndex, newMediaItem)
            player.seekTo(currentIndex, 0)
            player.playWhenReady = wasPlaying

            Log.d(TAG, "seek-by-reload: offset=${timeOffsetSeconds}s, seekTimeOffsetMs=$seekTimeOffsetMs")
        } else {
            seekTimeOffsetMs = 0
            player.seekTo(positionMs)
        }
        // Reschedule pre-apply since position changed
        hasPreAppliedNextGain = false
        replayGainProcessor.clearPendingGain()
        scheduleReplayGainPreApply()

        // Broadcast new position to followers immediately
        sendPlaybackStateHeartbeat(player.playWhenReady)
    }

    // === Autonomous queue management ===

    /**
     * Initialize session config for direct API calls.
     */
    @OptIn(UnstableApi::class)
    fun initSession(config: SessionConfig) {
        apiClient.setSessionConfig(config)
        // Set auth headers on ExoPlayer's HTTP data source so streaming
        // and cover art requests use headers instead of URL query params.
        httpDataSourceFactory?.setDefaultRequestProperties(apiClient.getAuthHeaders())
        // Connect SSE for remote control if session ID is available
        connectSessionSSE()
    }

    /**
     * Connect to the SSE stream for remote control when the JS WebView is backgrounded.
     * Handles PlaybackCommand (play/pause/skip/seek), QueueChanged/Updated (refetch),
     * VolumeChange, ClientListChanged, and OwnerChanged events.
     */
    private fun connectSessionSSE() {
        apiClient.connectSSE(object : SessionEventListener {
            override fun onConnected() {
                sseConnected = true
                Log.d(TAG, "SSE remote control connected")
            }

            override fun onEvent(event: SessionEvent) {
                handler.post { handleSessionEvent(event) }
            }

            override fun onDisconnected() {
                sseConnected = false
                // Auto-reconnect after delay if in autonomous mode
                if (autonomousMode) {
                    sseReconnectRunnable = Runnable { connectSessionSSE() }
                    handler.postDelayed(sseReconnectRunnable!!, SSE_RECONNECT_DELAY_MS)
                }
            }
        })
    }

    private fun handleSessionEvent(event: SessionEvent) {
        when (event) {
            is SessionEvent.PlaybackCommand -> {
                Log.d(TAG, "SSE PlaybackCommand: action=${event.action}, positionMs=${event.positionMs}")
                when (event.action) {
                    "play" -> { player.playWhenReady = true }
                    "pause" -> { player.playWhenReady = false }
                    "next" -> autonomousSkipNext()
                    "previous" -> autonomousSkipPrevious()
                    "seek" -> event.positionMs?.let { seek(it) }
                }
            }
            is SessionEvent.QueueChanged -> {
                Log.d(TAG, "SSE QueueChanged: refetching queue")
                if (autonomousMode) {
                    apiExecutor.execute {
                        try {
                            val response = apiClient.getQueueWindow(20)
                            handler.post {
                                handleQueueWindowResponse(response, response.currentIndex, response.positionMs, true)
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "SSE: failed to refetch queue after QueueChanged", e)
                        }
                    }
                }
            }
            is SessionEvent.QueueUpdated -> {
                Log.d(TAG, "SSE QueueUpdated: surgically updating queue")
                if (autonomousMode) {
                    val versionAtStart = invalidateVersion
                    apiExecutor.execute {
                        try {
                            val response = apiClient.getQueueWindow(20)
                            handler.post {
                                // Update serverQueueIndex before surgical update
                                serverQueueIndex = response.currentIndex

                                // Check if the currently playing track is still the track
                                // at the target position. If not (e.g., current track was
                                // removed), do a full reload to start the new current track.
                                val targetSongId = response.window.songs
                                    .find { it.position == response.currentIndex }?.song?.id
                                val currentMediaId = if (player.mediaItemCount > 0) {
                                    player.currentMediaItem?.mediaId
                                } else null

                                if (currentMediaId != null && targetSongId != null &&
                                    currentMediaId != targetSongId) {
                                    // If invalidateQueue() was called since we started this
                                    // fetch, skip the full reload — invalidateQueue already
                                    // handles it with the correct player.currentPosition.
                                    if (invalidateVersion != versionAtStart) {
                                        Log.d(TAG, "SSE QueueUpdated: skipping full reload, invalidateQueue pending")
                                        handleShuffleQueueUpdate(response, response.currentIndex)
                                    } else {
                                        Log.d(TAG, "SSE QueueUpdated: current track removed, doing full reload")
                                        // Use player.currentPosition instead of response.positionMs
                                        // because the DB value may be stale (not updated during
                                        // queue manipulations like add/remove/move)
                                        handleQueueWindowResponse(
                                            response, response.currentIndex,
                                            player.currentPosition, player.playWhenReady)
                                    }
                                } else {
                                    // Surgically update ExoPlayer's queue without restarting
                                    // the currently playing track. This handles follower-initiated
                                    // changes (shuffle, repeat, add/remove/move) gracefully.
                                    handleShuffleQueueUpdate(response, response.currentIndex)
                                    // Update repeat mode on ExoPlayer (handleShuffleQueueUpdate
                                    // updates the field but doesn't set player.repeatMode)
                                    player.repeatMode = if (response.repeatMode == "one")
                                        Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
                                }
                                // Don't emit queue-state-changed here: the JS SSE handler
                                // also receives QueueUpdated and calls fetchQueueSilent which
                                // updates both serverQueueStateAtom and queueWindowAtom
                                // atomically. Emitting here would cause a transient mismatch
                                // where currentIndex points to a different song in the old window.
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "SSE: failed to refetch queue after QueueUpdated", e)
                        }
                    }
                }
            }
            is SessionEvent.VolumeChange -> {
                Log.d(TAG, "SSE VolumeChange: volume=${event.volume}, muted=${event.isMuted}")
                userVolume = event.volume
                applyVolume()
            }
            is SessionEvent.PositionUpdate -> {
                // Owner's position updates — ignore when we ARE the owner (autonomous mode)
                // These are useful when this device becomes a follower in the future
            }
            is SessionEvent.ClientListChanged -> {
                Log.d(TAG, "SSE ClientListChanged: ignoring on Android")
            }
            is SessionEvent.OwnerChanged -> {
                Log.d(TAG, "SSE OwnerChanged: owner=${event.ownerClientId}")
            }
        }
    }

    /**
     * Update playback settings (ReplayGain, transcoding, scrobble threshold).
     */
    fun updateSettings(settings: PlaybackSettings) {
        Log.d(TAG, "updateSettings: replayGainMode=${settings.replayGainMode}, " +
            "replayGainOffset=${settings.replayGainOffset}, " +
            "transcodingEnabled=${settings.transcodingEnabled}")
        playbackSettings = settings
        // Re-apply ReplayGain to current track with new settings
        applyTrackReplayGain(currentTrack)
    }

    /**
     * Start autonomous playback: Kotlin takes over queue management.
     * JS calls this after starting a queue on the server. Kotlin fetches
     * the initial window and manages everything from here.
     */
    fun startAutonomousPlayback(
        totalCount: Int,
        currentIndex: Int,
        isShuffled: Boolean,
        repeatMode: String,
        playWhenReady: Boolean,
        startPositionMs: Long = 0,
        sessionId: String? = null,
        sourceType: String? = null,
        sourceId: String? = null,
    ) {
        Log.d(TAG, "startAutonomousPlayback(total=$totalCount, index=$currentIndex, " +
            "shuffled=$isShuffled, repeat=$repeatMode, play=$playWhenReady, sessionId=$sessionId, " +
            "sourceType=$sourceType, sourceId=$sourceId)")

        // Update session ID on the API client if provided
        if (sessionId != null) {
            apiClient.updateSessionId(sessionId)
        }

        autonomousMode = true
        queueSourceType = sourceType
        queueSourceId = sourceId
        serverTotalCount = totalCount
        serverQueueIndex = currentIndex
        this.isShuffled = isShuffled
        this.repeatMode = repeatMode
        isFetching = false
        resetScrobbleState()

        handler.removeCallbacks(endedTimeoutRunnable)
        handler.removeCallbacks(inactivityTimeoutRunnable)

        // Fetch initial window and start playback
        apiExecutor.execute {
            try {
                val response = apiClient.getQueueWindow(20)
                handler.post {
                    // Preserve playWhenReady if already true (e.g. invalidateQueue
                    // started playback before this handler.post ran)
                    val effectivePlay = playWhenReady || pendingPlayOnNextQueue || player.playWhenReady
                    handleQueueWindowResponse(response, currentIndex, startPositionMs, effectivePlay)
                    pendingPlayOnNextQueue = false
                    // Start position sync
                    handler.removeCallbacks(positionSyncRunnable)
                    handler.postDelayed(positionSyncRunnable, POSITION_SYNC_INTERVAL_MS)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to fetch initial queue window", e)
                handler.post {
                    emitError("Failed to load queue: ${e.message}", null)
                }
            }
        }
    }

    /**
     * Process a queue window response and load tracks into ExoPlayer.
     */
    private fun handleQueueWindowResponse(
        response: GetQueueResponse,
        targetIndex: Int,
        startPositionMs: Long,
        playWhenReady: Boolean,
    ) {
        serverTotalCount = response.totalCount
        this.isShuffled = response.isShuffled
        this.repeatMode = response.repeatMode

        val sortedEntries = response.window.songs.sortedBy { it.position }
        if (sortedEntries.isEmpty()) {
            Log.w(TAG, "Empty queue window received")
            return
        }

        // Convert to TrackInfo and store raw song data for gain recomputation
        val tracks = sortedEntries.map { entry ->
            apiClient.songToTrackInfo(entry.song, playbackSettings)
        }

        // Build position mapping and raw song data
        exoIndexToServerPosition = sortedEntries.map { it.position }.toMutableList()
        exoIndexToQueueSong = sortedEntries.map { it.song as QueueSong? }.toMutableList()
        loadedRangeStart = sortedEntries.first().position
        loadedRangeEnd = sortedEntries.last().position + 1

        // Find ExoPlayer start index for the target server position
        val exoStartIndex = exoIndexToServerPosition.indexOf(targetIndex)
            .let { if (it < 0) 0 else it }

        queue = tracks
        queueOffset = loadedRangeStart
        queueIndex = targetIndex
        currentTrack = tracks.getOrNull(exoStartIndex)

        applyTrackReplayGain(currentTrack)

        val mediaItems = tracks.map { createMediaItem(it) }.toMutableList()

        // For transcoded streams, ExoPlayer can't seek via Range headers.
        // Use seek-by-reload: rebuild the current track's URL with a timeOffset
        // parameter so the server sends audio starting from the right position.
        if (startPositionMs > 0 && playbackSettings.transcodingEnabled && currentTrack != null) {
            val track = currentTrack!!
            val timeOffsetSeconds = startPositionMs / 1000
            val newUrl = apiClient.buildStreamUrl(track.id, playbackSettings, timeOffsetSeconds)
            seekTimeOffsetMs = startPositionMs

            val metadataBuilder = MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist)
                .setAlbumTitle(track.album)
                .setDurationMs(track.durationMs)
            if (track.coverArtUrl != null) {
                metadataBuilder.setArtworkUri(Uri.parse(track.coverArtUrl))
            }

            val newMediaItem = MediaItem.Builder()
                .setMediaId(track.id)
                .setUri(Uri.parse(newUrl))
                .setMediaMetadata(metadataBuilder.build())
                .build()

            mediaItems[exoStartIndex] = newMediaItem

            player.playWhenReady = playWhenReady
            player.setMediaItems(mediaItems, exoStartIndex, 0)
            player.prepare()

            Log.d(TAG, "Loaded ${tracks.size} tracks with seek-by-reload: offset=${timeOffsetSeconds}s, " +
                "positions $loadedRangeStart..${loadedRangeEnd - 1}, " +
                "exoStartIndex=$exoStartIndex, serverIndex=$targetIndex")
        } else {
            seekTimeOffsetMs = 0

            player.playWhenReady = playWhenReady
            player.setMediaItems(mediaItems, exoStartIndex, startPositionMs)
            player.prepare()

            Log.d(TAG, "Loaded ${tracks.size} tracks, positions $loadedRangeStart..${loadedRangeEnd - 1}, " +
                "exoStartIndex=$exoStartIndex, serverIndex=$targetIndex")
        }

        emitTrackChange()
        emitQueueStateChanged()
    }

    /**
     * Check if we need to fetch more tracks and do so if needed.
     */
    private fun maybePrefetchMore() {
        if (!autonomousMode || isFetching) return
        if (!isNetworkAvailable()) return

        val exoIndex = player.currentMediaItemIndex
        val itemsRemaining = player.mediaItemCount - exoIndex - 1
        val serverPos = exoIndexToServerPosition.getOrNull(exoIndex) ?: return

        // Check if we need more songs ahead
        val needsMoreAhead = itemsRemaining <= PREFETCH_THRESHOLD &&
            loadedRangeEnd < serverTotalCount

        // Check if we need more songs behind (for previous track navigation)
        val needsMoreBehind = exoIndex <= PREFETCH_THRESHOLD &&
            loadedRangeStart > 0

        if (!needsMoreAhead && !needsMoreBehind) return

        isFetching = true
        Log.d(TAG, "Prefetching: ahead=$needsMoreAhead, behind=$needsMoreBehind, " +
            "serverPos=$serverPos, loaded=$loadedRangeStart..${loadedRangeEnd - 1}")

        apiExecutor.execute {
            try {
                val response = apiClient.getQueueWindow(20)
                handler.post { handlePrefetchResponse(response) }
            } catch (e: Exception) {
                Log.e(TAG, "Prefetch failed", e)
                handler.post { isFetching = false }
            }
        }
    }

    /**
     * Handle a prefetch response: append/prepend new songs to ExoPlayer's queue.
     */
    private fun handlePrefetchResponse(response: GetQueueResponse) {
        isFetching = false
        serverTotalCount = response.totalCount

        val sortedEntries = response.window.songs.sortedBy { it.position }
        if (sortedEntries.isEmpty()) return

        // Find entries that are not yet loaded
        val newAheadEntries = sortedEntries.filter { it.position >= loadedRangeEnd }
        val newBehindEntries = sortedEntries.filter { it.position < loadedRangeStart }

        if (newAheadEntries.isNotEmpty()) {
            val newTracks = newAheadEntries.map { apiClient.songToTrackInfo(it.song, playbackSettings) }
            val newMediaItems = newTracks.map { createMediaItem(it) }

            queue = queue + newTracks
            exoIndexToServerPosition.addAll(newAheadEntries.map { it.position })
            exoIndexToQueueSong.addAll(newAheadEntries.map { it.song })
            player.addMediaItems(newMediaItems)
            loadedRangeEnd = newAheadEntries.last().position + 1

            Log.d(TAG, "Appended ${newTracks.size} tracks, range now $loadedRangeStart..${loadedRangeEnd - 1}")
        }

        if (newBehindEntries.isNotEmpty()) {
            val newTracks = newBehindEntries.map { apiClient.songToTrackInfo(it.song, playbackSettings) }
            val newMediaItems = newTracks.map { createMediaItem(it) }
            val newPositions = newBehindEntries.map { it.position }

            // Prepend to ExoPlayer and our tracking structures
            queue = newTracks + queue
            exoIndexToServerPosition.addAll(0, newPositions)
            exoIndexToQueueSong.addAll(0, newBehindEntries.map { it.song })
            for (i in newMediaItems.indices) {
                player.addMediaItem(i, newMediaItems[i])
            }
            loadedRangeStart = newBehindEntries.first().position
            // Update queueOffset  
            queueOffset = loadedRangeStart

            Log.d(TAG, "Prepended ${newTracks.size} tracks, range now $loadedRangeStart..${loadedRangeEnd - 1}")
        }
    }

    /**
     * Handle skip-next in autonomous mode.
     */
    private fun autonomousSkipNext() {
        seekTimeOffsetMs = 0
        Log.d(TAG, "autonomousSkipNext: serverIndex=$serverQueueIndex, total=$serverTotalCount")
        val nextIndex = serverQueueIndex + 1

        if (nextIndex >= serverTotalCount) {
            if (repeatMode == "all") {
                // Wrap around, reshuffle if needed
                Log.d(TAG, "Repeat-all wrap: back to 0, reshuffle=$isShuffled")
                serverQueueIndex = 0
                resetScrobbleState()
                apiExecutor.execute {
                    try {
                        apiClient.updatePosition(0, 0, reshuffle = isShuffled)
                        val response = apiClient.getQueueWindow(20)
                        handler.post {
                            handleQueueWindowResponse(response, 0, 0, true)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to wrap queue", e)
                    }
                }
            } else {
                // End of queue, no repeat
                Log.d(TAG, "End of queue, stopping")
                // Sync final position to server so it knows we reached the end
                syncPositionToServer()
                player.pause()
                emitStateChange()
            }
            return
        }

        serverQueueIndex = nextIndex
        resetScrobbleState()

        // Check if the next track is already loaded in ExoPlayer
        val exoIndex = exoIndexToServerPosition.indexOf(nextIndex)
        if (exoIndex >= 0) {
            player.playWhenReady = true
            player.seekTo(exoIndex, 0)
            // If player is in STATE_ENDED (all loaded items exhausted, e.g.
            // very short tracks played faster than prefetch), re-prepare so
            // ExoPlayer transitions out of the ended state.
            if (player.playbackState == Player.STATE_ENDED) {
                Log.d(TAG, "autonomousSkipNext: re-preparing player from STATE_ENDED")
                player.prepare()
            }
            maybePrefetchMore()
        } else {
            // Not loaded, fetch a new window
            Log.d(TAG, "Next track not loaded, fetching window for position $nextIndex")
            apiExecutor.execute {
                try {
                    apiClient.updatePosition(nextIndex, 0)
                    val response = apiClient.getQueueWindow(20)
                    handler.post {
                        handleQueueWindowResponse(response, nextIndex, 0, true)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to fetch window for skip next", e)
                }
            }
        }
    }

    /**
     * Handle skip-previous in autonomous mode.
     */
    private fun autonomousSkipPrevious() {
        Log.d(TAG, "autonomousSkipPrevious: serverIndex=$serverQueueIndex, pos=${player.currentPosition}")

        // If more than 3 seconds in, restart current track
        if (player.currentPosition > 3000) {
            player.playWhenReady = true
            seek(0) // Use seek() to properly reload transcoded streams from beginning
            accumulatedListenMs = 0
            hasScrobbled = false
            return
        }

        seekTimeOffsetMs = 0
        val prevIndex = serverQueueIndex - 1
        if (prevIndex < 0) {
            if (repeatMode == "all") {
                serverQueueIndex = serverTotalCount - 1
                resetScrobbleState()
                apiExecutor.execute {
                    try {
                        apiClient.updatePosition(serverTotalCount - 1, 0)
                        val response = apiClient.getQueueWindow(20)
                        handler.post {
                            handleQueueWindowResponse(response, serverTotalCount - 1, 0, true)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to wrap queue backward", e)
                    }
                }
            } else {
                player.seekTo(0)
            }
            return
        }

        serverQueueIndex = prevIndex
        resetScrobbleState()

        val exoIndex = exoIndexToServerPosition.indexOf(prevIndex)
        if (exoIndex >= 0) {
            player.playWhenReady = true
            player.seekTo(exoIndex, 0)
            maybePrefetchMore()
        } else {
            apiExecutor.execute {
                try {
                    apiClient.updatePosition(prevIndex, 0)
                    val response = apiClient.getQueueWindow(20)
                    handler.post {
                        handleQueueWindowResponse(response, prevIndex, 0, true)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to fetch window for skip previous", e)
                }
            }
        }
    }

    /**
     * Toggle shuffle in autonomous mode.
     * Surgically updates surrounding tracks without interrupting the currently playing track.
     */
    fun autonomousToggleShuffle(enabled: Boolean): CompletableDeferred<Unit> {
        val deferred = CompletableDeferred<Unit>()
        if (!autonomousMode) {
            deferred.complete(Unit)
            return deferred
        }
        Log.d(TAG, "autonomousToggleShuffle($enabled)")
        val currentPositionMs = player.currentPosition
        apiExecutor.execute {
            try {
                val shuffleResponse = apiClient.toggleShuffle(enabled)
                val newIndex = shuffleResponse.newIndex ?: serverQueueIndex
                // Fetch the reordered queue window
                apiClient.updatePosition(newIndex, currentPositionMs)
                val queueResponse = apiClient.getQueueWindow(20)
                handler.post {
                    isShuffled = enabled
                    serverQueueIndex = newIndex
                    handleShuffleQueueUpdate(queueResponse, newIndex)
                    eventEmitter?.invoke(AudioEvents.SHUFFLE_MODE_CHANGED, JSObject().apply {
                        put("enabled", enabled)
                    })
                    deferred.complete(Unit)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle shuffle", e)
                deferred.completeExceptionally(e)
            }
        }
        return deferred
    }

    /**
     * Handle a queue window update after shuffle toggle without interrupting playback.
     * Instead of rebuilding the entire ExoPlayer playlist (which causes audio interruption),
     * this method surgically removes and re-adds surrounding tracks while keeping the
     * currently playing track in place.
     */
    private fun handleShuffleQueueUpdate(
        response: GetQueueResponse,
        targetIndex: Int,
    ) {
        serverTotalCount = response.totalCount
        this.isShuffled = response.isShuffled
        this.repeatMode = response.repeatMode

        val sortedEntries = response.window.songs.sortedBy { it.position }
        if (sortedEntries.isEmpty()) return

        val tracks = sortedEntries.map { entry ->
            apiClient.songToTrackInfo(entry.song, playbackSettings)
        }
        val newPositions = sortedEntries.map { it.position }

        // Find which entry in the new window corresponds to the current track
        val targetExoIndex = newPositions.indexOf(targetIndex)
            .let { if (it < 0) 0 else it }

        // Get current ExoPlayer state before modifications
        val currentExoIndex = player.currentMediaItemIndex
        val itemCount = player.mediaItemCount

        // Remove all items AFTER the current track
        if (currentExoIndex < itemCount - 1) {
            player.removeMediaItems(currentExoIndex + 1, itemCount)
        }
        // Remove all items BEFORE the current track
        if (currentExoIndex > 0) {
            player.removeMediaItems(0, currentExoIndex)
        }
        // Now ExoPlayer has only the current track at index 0

        // Create and add MediaItems for tracks before the current track
        if (targetExoIndex > 0) {
            val beforeItems = tracks.subList(0, targetExoIndex).map { createMediaItem(it) }
            player.addMediaItems(0, beforeItems)
        }

        // Create and add MediaItems for tracks after the current track
        if (targetExoIndex + 1 < tracks.size) {
            val afterItems = tracks.subList(targetExoIndex + 1, tracks.size).map { createMediaItem(it) }
            player.addMediaItems(player.mediaItemCount, afterItems)
        }

        // Update tracking structures
        exoIndexToServerPosition = newPositions.toMutableList()
        exoIndexToQueueSong = sortedEntries.map { it.song as QueueSong? }.toMutableList()
        loadedRangeStart = sortedEntries.first().position
        loadedRangeEnd = sortedEntries.last().position + 1

        queue = tracks
        queueOffset = loadedRangeStart
        queueIndex = targetIndex
        // Don't update currentTrack or emit track change — the same track is still playing
        // Don't emit queue-state-changed here: the JS toggleShuffleAtom updates both
        // serverQueueStateAtom and queueWindowAtom atomically after nativeToggleShuffle
        // resolves. Emitting the event here would cause a transient mismatch where
        // currentIndex points to a different song in the old window.

        Log.d(TAG, "Shuffle update: ${tracks.size} tracks, positions $loadedRangeStart..${loadedRangeEnd - 1}, " +
            "targetExoIndex=$targetExoIndex, serverIndex=$targetIndex")
    }

    /**
     * Set repeat mode in autonomous mode.
     */
    fun autonomousSetRepeatMode(mode: String) {
        if (!autonomousMode) return
        Log.d(TAG, "autonomousSetRepeatMode($mode)")

        repeatMode = mode
        // Set ExoPlayer repeat mode for repeat-one
        player.repeatMode = if (mode == "one") Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF

        apiExecutor.execute {
            try {
                apiClient.setRepeatMode(mode)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set repeat mode on server", e)
            }
        }

        updateMediaButtonPreferences()
        eventEmitter?.invoke(AudioEvents.REPEAT_MODE_CHANGED, JSObject().apply {
            put("mode", mode)
        })
    }

    /**
     * Invalidate the queue window and refetch from server.
     * Called when JS modifies the queue (add/remove/reorder).
     */
    fun invalidateQueue() {
        if (!autonomousMode) return
        invalidateVersion++
        Log.d(TAG, "invalidateQueue: refetching at position $serverQueueIndex (version=$invalidateVersion)")
        apiExecutor.execute {
            try {
                val response = apiClient.getQueueWindow(20)
                handler.post {
                    val shouldPlay = player.playWhenReady || pendingPlayOnNextQueue
                    pendingPlayOnNextQueue = false

                    // Check if the currently playing track is still the track
                    // at the target position. If so, surgically update the
                    // surrounding items to avoid restarting playback.
                    val targetSongId = response.window.songs
                        .find { it.position == response.currentIndex }?.song?.id
                    val currentMediaId = if (player.mediaItemCount > 0) {
                        player.currentMediaItem?.mediaId
                    } else null

                    if (currentMediaId != null && targetSongId != null &&
                        currentMediaId == targetSongId) {
                        Log.d(TAG, "invalidateQueue: current track unchanged, surgical update")
                        serverQueueIndex = response.currentIndex
                        handleShuffleQueueUpdate(response, response.currentIndex)
                        player.repeatMode = if (response.repeatMode == "one")
                            Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
                        if (shouldPlay && !player.playWhenReady) {
                            player.playWhenReady = true
                        }
                        emitQueueStateChanged()
                    } else {
                        Log.d(TAG, "invalidateQueue: current track changed, full reload")
                        handleQueueWindowResponse(response, response.currentIndex,
                            player.currentPosition, shouldPlay)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to invalidate queue", e)
            }
        }
    }

    /**
     * Soft invalidate: update the total count and prefetch new songs without
     * rebuilding the ExoPlayer playlist. Used for "play next" / "add to queue"
     * to avoid briefly interrupting playback.
     */
    fun softInvalidateQueue(newTotalCount: Int) {
        if (!autonomousMode) return
        Log.d(TAG, "softInvalidateQueue: totalCount $serverTotalCount -> $newTotalCount")
        serverTotalCount = newTotalCount
        // Trigger prefetch to pick up new songs appended/inserted near current position
        maybePrefetchMore()
    }

    // === Scrobbling ===

    private fun resetScrobbleState() {
        accumulatedListenMs = 0
        hasScrobbled = false
        lastProgressTimestamp = 0
    }

    private fun checkScrobble() {
        if (!autonomousMode || hasScrobbled) return
        val track = currentTrack ?: return
        val durationMs = track.durationMs
        if (durationMs <= 0) return

        val threshold = playbackSettings.scrobbleThreshold
        if (accumulatedListenMs.toFloat() / durationMs >= threshold) {
            hasScrobbled = true
            Log.d(TAG, "Scrobbling track: ${track.title} (${accumulatedListenMs}ms / ${durationMs}ms)")
            val songId = track.id
            apiExecutor.execute {
                try {
                    apiClient.scrobble(songId, System.currentTimeMillis(), queueSourceType = queueSourceType, queueSourceId = queueSourceId)
                } catch (e: Exception) {
                    Log.e(TAG, "Scrobble failed for $songId", e)
                }
            }
            // Notify JS so UI can update play counts
            eventEmitter?.invoke(AudioEvents.SCROBBLE, JSObject().apply {
                put("trackId", songId)
            })
        }
    }

    private fun syncPositionToServer() {
        if (!autonomousMode) return
        if (!isNetworkAvailable()) return
        val posMs = (player.currentPosition + seekTimeOffsetMs).coerceAtLeast(0)
        apiExecutor.execute {
            try {
                apiClient.updatePosition(serverQueueIndex, posMs)
            } catch (e: Exception) {
                Log.w(TAG, "Position sync failed", e)
            }
        }
    }

    /**
     * Send an immediate heartbeat to the server so followers see the correct
     * is_playing state without waiting for the JS heartbeat interval (30s).
     */
    private fun sendPlaybackStateHeartbeat(isPlaying: Boolean) {
        if (!isNetworkAvailable()) return
        val track = currentTrack
        val posMs = (player.currentPosition + seekTimeOffsetMs).coerceAtLeast(0)
        apiExecutor.execute {
            try {
                apiClient.sendHeartbeat(
                    isPlaying = isPlaying,
                    currentIndex = serverQueueIndex,
                    positionMs = posMs,
                    currentSongId = track?.id,
                    currentSongTitle = track?.title,
                    currentSongArtist = track?.artist,
                )
            } catch (e: Exception) {
                Log.w(TAG, "Playback state heartbeat failed", e)
            }
        }
    }

    fun setTrack(track: TrackInfo) {
        Log.d(TAG, "setTrack(${track.title}) - url: ${track.url}")
        handler.removeCallbacks(endedTimeoutRunnable)
        handler.removeCallbacks(inactivityTimeoutRunnable)

        currentTrack = track
        seekTimeOffsetMs = 0
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
        handler.removeCallbacks(inactivityTimeoutRunnable)
        queue = items
        queueOffset = offset
        queueIndex = offset + startIndex.coerceIn(0, items.size - 1)
        currentTrack = items.getOrNull(startIndex.coerceIn(0, items.size - 1))
        seekTimeOffsetMs = 0

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
        Log.d(TAG, "appendToQueue(${items.size} items, autonomous=$autonomousMode)")
        queue = queue + items
        // Keep exoIndexToQueueSong in sync — items from JS don't have QueueSong data,
        // so add null entries. The fallback in applyTrackReplayGain will use
        // TrackInfo.replayGainDb instead.
        for (item in items) {
            exoIndexToQueueSong.add(null)
            // Also track server position if possible
            exoIndexToServerPosition.add(loadedRangeEnd)
            loadedRangeEnd++
        }
        val mediaItems = items.map { createMediaItem(it) }
        player.addMediaItems(mediaItems)
    }

    fun setRepeatMode(mode: String) {
        Log.d(TAG, "setRepeatMode($mode)")
        if (autonomousMode) {
            autonomousSetRepeatMode(mode)
            return
        }
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
        if (autonomousMode) {
            autonomousSkipNext()
            return
        }
        seekTimeOffsetMs = 0
        if (player.hasNextMediaItem()) {
            player.seekToNextMediaItem()
        }
    }

    fun previousTrack() {
        Log.d(TAG, "previousTrack()")
        if (autonomousMode) {
            autonomousSkipPrevious()
            return
        }
        // If more than 3 seconds in, restart current track
        if (player.currentPosition > 3000) {
            seek(0) // Use seek() to properly reload transcoded streams from beginning
        } else {
            seekTimeOffsetMs = 0
            if (player.hasPreviousMediaItem()) {
                player.seekToPreviousMediaItem()
            } else {
                seek(0)
            }
        }
    }

    fun setVolume(volume: Float) {
        Log.d(TAG, "setVolume($volume)")
        userVolume = volume.coerceIn(0f, 1f)
        applyVolume()
    }

    /**
     * Set ReplayGain boost/attenuation in millibels.
     * Gain is applied exclusively via ReplayGainAudioProcessor at the PCM level.
     */
    fun setReplayGain(gainMb: Int) {
        val gainDb = gainMb.toFloat() / 100f
        replayGainLinear = if (gainDb == 0f) 1f else 10f.pow(gainDb / 20f)
        Log.d(TAG, "setReplayGain($gainMb mB -> ${String.format("%.2f", gainDb)} dB, linear=${String.format("%.4f", replayGainLinear)})")
        replayGainProcessor.setGainDb(gainDb)
        replayGainProcessor.resetPeakTracker()
    }

    /**
     * Pre-apply the next track's ReplayGain when approaching the end of the current track.
     * This prevents a brief volume spike during gapless transitions, because ExoPlayer
     * pre-decodes audio from the next track before onMediaItemTransition fires.
     * Instead of changing the gain immediately (which would affect the current track's
     * remaining audio), we set a pending gain on the processor that activates at the
     * exact PCM boundary between tracks (via onQueueEndOfStream/onFlush).
     *
     * Called by a scheduled handler callback before the current track ends.
     */
    private fun preApplyNextTrackGain() {
        if (hasPreAppliedNextGain) return

        val nextExoIndex = player.currentMediaItemIndex + 1
        if (nextExoIndex >= player.mediaItemCount) return

        val nextQueueSong = exoIndexToQueueSong.getOrNull(nextExoIndex)
        val nextTrack = queue.getOrNull(nextExoIndex)

        val gainDb = if (nextQueueSong != null) {
            apiClient.computeReplayGainDb(nextQueueSong, playbackSettings) ?: 0f
        } else {
            nextTrack?.replayGainDb ?: 0f
        }

        hasPreAppliedNextGain = true
        Log.d(TAG, "Pre-applying next track ReplayGain (pending): ${String.format("%.2f", gainDb)} dB " +
            "(nextExoIndex=$nextExoIndex)")
        replayGainProcessor.setPendingGainDb(gainDb)
    }

    private val preApplyGainRunnable = Runnable { preApplyNextTrackGain() }

    /**
     * Schedule pre-application of the next track's ReplayGain at a precise time
     * before the current track ends. Uses Handler.postDelayed based on the player's
     * current position and the track's duration for accurate scheduling.
     */
    private fun scheduleReplayGainPreApply() {
        handler.removeCallbacks(preApplyGainRunnable)
        val track = currentTrack ?: return
        if (track.durationMs <= 0) return
        if (player.currentMediaItemIndex + 1 >= player.mediaItemCount) return

        val currentPos = player.currentPosition + seekTimeOffsetMs
        val remaining = track.durationMs - currentPos
        val delay = remaining - REPLAYGAIN_PRE_APPLY_LEAD_MS

        if (delay <= 0) {
            // Already past the pre-apply point, apply immediately
            preApplyNextTrackGain()
        } else {
            handler.postDelayed(preApplyGainRunnable, delay)
        }
    }

    private fun applyTrackReplayGain(track: TrackInfo?) {
        // Reset pre-apply flag so it can trigger again for the next transition
        hasPreAppliedNextGain = false
        // Clear any pending gain from a previous pre-apply (e.g., manual skip)
        replayGainProcessor.clearPendingGain()
        // In autonomous mode, recompute gain fresh from QueueSong + current playbackSettings
        // instead of relying on the stale TrackInfo.replayGainDb baked at queue-creation time.
        val exoIndex = player.currentMediaItemIndex
        val queueSong = exoIndexToQueueSong.getOrNull(exoIndex)
        val gainDb = if (queueSong != null) {
            apiClient.computeReplayGainDb(queueSong, playbackSettings) ?: 0f
        } else {
            track?.replayGainDb ?: 0f
        }
        Log.d(TAG, "applyTrackReplayGain: gainDb=${String.format("%.2f", gainDb)} dB " +
            "(fromQueueSong=${queueSong != null}, exoIndex=$exoIndex, " +
            "queueSongListSize=${exoIndexToQueueSong.size}, " +
            "mode=${playbackSettings.replayGainMode}, " +
            "offset=${playbackSettings.replayGainOffset}, " +
            "trackReplayGainDb=${track?.replayGainDb})")
        replayGainLinear = if (gainDb == 0f) 1f else 10f.pow(gainDb / 20f)
        replayGainProcessor.setGainDb(gainDb)
        replayGainProcessor.resetPeakTracker()
        // Schedule pre-application of next track's gain before this track ends
        scheduleReplayGainPreApply()
    }

    /**
     * Apply user volume to ExoPlayer.
     * ReplayGain is handled exclusively by ReplayGainAudioProcessor at the PCM level,
     * so player.volume only reflects the user's volume setting.
     */
    private fun applyVolume() {
        // If we're in a transition, update the saved volume too
        if (transitionSavedVolume != null) {
            transitionSavedVolume = userVolume
        } else {
            player.volume = userVolume
        }
    }

    /**
     * Check if network connectivity is available.
     * Used to skip background API calls when offline.
     */
    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return true // Assume available if we can't check
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun getState(): PlaybackState {
        return PlaybackState(
            status = mapPlaybackState(player.playbackState, player.playWhenReady),
            positionMs = player.currentPosition.coerceAtLeast(0),
            durationMs = player.duration.let { if (it == C.TIME_UNSET) 0 else it },
            volume = userVolume,
            muted = userVolume == 0f,
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
            .setDurationMs(track.durationMs)

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
        val rawPosition = player.currentPosition
        val duration = currentTrack?.durationMs ?: player.duration.let { if (it == C.TIME_UNSET) 0 else it }
        val buffered = player.bufferedPosition

        eventEmitter?.invoke(AudioEvents.PROGRESS, JSObject().apply {
            put("positionMs", rawPosition + seekTimeOffsetMs)
            put("durationMs", duration)
            put("bufferedMs", buffered + seekTimeOffsetMs)
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

    private fun emitQueueStateChanged() {
        eventEmitter?.invoke(AudioEvents.QUEUE_STATE_CHANGED, JSObject().apply {
            put("totalCount", serverTotalCount)
            put("currentIndex", serverQueueIndex)
            put("isShuffled", isShuffled)
            put("repeatMode", repeatMode)
        })
    }

    private fun emitClippingEvent(peakOverDb: Float) {
        eventEmitter?.invoke(AudioEvents.CLIPPING, JSObject().apply {
            put("peakOverDb", peakOverDb.toDouble())
            put("timestamp", System.currentTimeMillis())
        })
    }

    private inner class PlayerListener : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            Log.d(TAG, "onPlaybackStateChanged: $playbackState")

            // Restore volume after track transition completes
            if (playbackState == Player.STATE_READY) {
                // Reset network retry counter on successful playback
                networkRetryCount = 0

                transitionSavedVolume?.let { savedVol ->
                    Log.d(TAG, "Restoring volume after transition: $savedVol")
                    player.volume = savedVol
                    transitionSavedVolume = null
                }
                // Force the forwarding player to re-emit state so the
                // notification picks up our duration/placeholder overrides
                // (important for transcoded streams where ExoPlayer reports
                // TIME_UNSET until the source is prepared).
                invalidateSessionPlayerState?.invoke()
            }

            emitStateChange()

            // Start/stop progress updates and inactivity timeout
            if (playbackState == Player.STATE_READY && player.playWhenReady) {
                lastProgressTimestamp = System.currentTimeMillis()
                handler.post(progressRunnable)
                handler.removeCallbacks(inactivityTimeoutRunnable)
                // Send heartbeat when playback becomes ready (e.g., after buffering)
                if (autonomousMode) {
                    sendPlaybackStateHeartbeat(true)
                }
            } else {
                if (!player.isPlaying) {
                    lastProgressTimestamp = 0
                }
                handler.removeCallbacks(progressRunnable)
            }

            if (autonomousMode) {
                // In autonomous mode, handle end-of-loaded-queue
                if (playbackState == Player.STATE_ENDED) {
                    // Verify serverQueueIndex matches ExoPlayer's current position.
                    // onMediaItemTransition updates serverQueueIndex as ExoPlayer auto-advances,
                    // so by the time STATE_ENDED fires, serverQueueIndex should reflect the
                    // last track played — if it doesn't, sync it.
                    val lastExoIndex = player.currentMediaItemIndex
                    val lastServerPos = exoIndexToServerPosition.getOrNull(lastExoIndex)
                    if (lastServerPos != null && lastServerPos != serverQueueIndex) {
                        Log.d(TAG, "STATE_ENDED: syncing serverQueueIndex from $serverQueueIndex to $lastServerPos")
                        serverQueueIndex = lastServerPos
                    }
                    // ExoPlayer ran out of loaded items, try to advance
                    autonomousSkipNext()
                    handler.postDelayed(inactivityTimeoutRunnable, INACTIVITY_TIMEOUT_MS)
                }
            } else {
                // Legacy mode: give JS time to advance
                if (playbackState == Player.STATE_ENDED) {
                    handler.postDelayed(endedTimeoutRunnable, 60_000)
                } else {
                    handler.removeCallbacks(endedTimeoutRunnable)
                }
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
                lastProgressTimestamp = System.currentTimeMillis()
                handler.post(progressRunnable)
                handler.removeCallbacks(inactivityTimeoutRunnable)
                if (autonomousMode) {
                    handler.removeCallbacks(positionSyncRunnable)
                    handler.postDelayed(positionSyncRunnable, POSITION_SYNC_INTERVAL_MS)
                    // Send immediate heartbeat so followers see is_playing=true
                    sendPlaybackStateHeartbeat(true)
                }
            } else {
                lastProgressTimestamp = 0
                handler.removeCallbacks(progressRunnable)
                handler.postDelayed(inactivityTimeoutRunnable, INACTIVITY_TIMEOUT_MS)
                if (autonomousMode) {
                    handler.removeCallbacks(positionSyncRunnable)
                    // Sync final position to server so it stays up-to-date on pause
                    syncPositionToServer()
                    // Send immediate heartbeat so followers see is_playing=false
                    sendPlaybackStateHeartbeat(false)
                }
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            Log.d(TAG, "onMediaItemTransition: ${mediaItem?.mediaId}, reason: $reason, exoIndex: ${player.currentMediaItemIndex}")

            // Reset network retry counter on track change
            networkRetryCount = 0

            // Reset seek offset when the actual track changes (different mediaId).
            // Don't reset on seek-by-reload (same mediaId, REASON_PLAYLIST_CHANGED).
            if (mediaItem?.mediaId != currentTrack?.id) {
                seekTimeOffsetMs = 0
            }

            val exoIndex = player.currentMediaItemIndex

            if (autonomousMode) {
                val serverPos = exoIndexToServerPosition.getOrNull(exoIndex)
                if (serverPos != null) {
                    serverQueueIndex = serverPos
                    queueIndex = serverPos
                } else {
                    queueIndex = queueOffset + exoIndex
                }
                currentTrack = queue.getOrNull(exoIndex)
                applyTrackReplayGain(currentTrack)
                resetScrobbleState()
                emitTrackChange()
                emitStateChange()

                // Sync position to server, send heartbeat for followers, and prefetch
                syncPositionToServer()
                sendPlaybackStateHeartbeat(player.playWhenReady)
                maybePrefetchMore()
            } else {
                queueIndex = queueOffset + exoIndex
                currentTrack = queue.getOrNull(exoIndex)
                applyTrackReplayGain(currentTrack)
                emitTrackChange()
                emitStateChange()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e(TAG, "onPlayerError: ${error.message}", error)

            // Retry on network errors (IO_ERROR) if we haven't exceeded the limit.
            // For transcoded streams, reload with the correct timeOffset to avoid
            // restarting playback from position 0.
            val isNetworkError = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                error.errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED ||
                error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS

            if (isNetworkError && networkRetryCount < MAX_NETWORK_RETRIES && currentTrack != null) {
                networkRetryCount++
                Log.d(TAG, "Network error retry $networkRetryCount/$MAX_NETWORK_RETRIES for track: ${currentTrack?.title}")
                handler.postDelayed({
                    val track = currentTrack ?: return@postDelayed
                    if (playbackSettings.transcodingEnabled) {
                        // For transcoded streams, rebuild URL with the current position
                        val positionMs = player.currentPosition + seekTimeOffsetMs
                        val timeOffsetSeconds = positionMs / 1000
                        seekTimeOffsetMs = positionMs
                        val newUrl = apiClient.buildStreamUrl(track.id, playbackSettings, timeOffsetSeconds)

                        val metadataBuilder = MediaMetadata.Builder()
                            .setTitle(track.title)
                            .setArtist(track.artist)
                            .setAlbumTitle(track.album)
                            .setDurationMs(track.durationMs)
                        if (track.coverArtUrl != null) {
                            metadataBuilder.setArtworkUri(Uri.parse(track.coverArtUrl))
                        }

                        val newMediaItem = MediaItem.Builder()
                            .setMediaId(track.id)
                            .setUri(Uri.parse(newUrl))
                            .setMediaMetadata(metadataBuilder.build())
                            .build()

                        val currentIndex = player.currentMediaItemIndex
                        player.replaceMediaItem(currentIndex, newMediaItem)
                        player.seekTo(currentIndex, 0)
                        player.playWhenReady = true
                        player.prepare()
                        Log.d(TAG, "Network retry: reloaded transcoded stream at offset ${timeOffsetSeconds}s")
                    } else {
                        // For non-transcoded streams, just re-prepare at the current position
                        player.playWhenReady = true
                        player.prepare()
                        Log.d(TAG, "Network retry: re-prepared non-transcoded stream")
                    }
                }, NETWORK_RETRY_DELAY_MS)
                return
            }

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
            if (!autonomousMode) {
                eventEmitter?.invoke(AudioEvents.SHUFFLE_MODE_CHANGED, JSObject().apply {
                    put("enabled", shuffleModeEnabled)
                })
            }
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            val mode = when (repeatMode) {
                Player.REPEAT_MODE_ONE -> "one"
                Player.REPEAT_MODE_ALL -> "all"
                else -> "off"
            }
            Log.d(TAG, "onRepeatModeChanged: $mode")
            updateMediaButtonPreferences()
            if (!autonomousMode) {
                eventEmitter?.invoke(AudioEvents.REPEAT_MODE_CHANGED, JSObject().apply {
                    put("mode", mode)
                })
            }
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
