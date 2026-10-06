package com.ferrotune.feature.player

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackEvent
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.media.SessionRemoteControl
import com.ferrotune.core.media.TrackInfo
import com.ferrotune.core.media.WaveformRepository
import com.ferrotune.core.media.cast.CastConnectionState
import com.ferrotune.core.media.cast.CastManager
import com.ferrotune.core.media.cast.CastMediaStatus
import com.ferrotune.core.media.cast.CastPlaybackHandoff
import com.ferrotune.core.media.isFollowing
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Everything the player chrome shows except the playback position, which
 * lives in [PlaybackProgress] so a progress tick never recomposes the whole
 * player.
 */
@Immutable
data class PlayerUiState(
    val track: TrackInfo? = null,
    val previousTrack: TrackInfo? = null,
    val nextTrack: TrackInfo? = null,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val queueIndex: Int = -1,
    val queueLength: Int = 0,
    val isShuffled: Boolean = false,
    val repeatMode: String = "off",
    val sourceName: String? = null,
    val sourceType: String? = null,
    val isStartingQueue: Boolean = false,
    val error: String? = null,
    val cast: CastConnectionState = CastConnectionState(),
    val castStatus: CastMediaStatus? = null,
    val progressBarStyle: String = "waveform",
    val waveform: WaveformData = WaveformData(),
)

/** The current song's waveform: flat bars while [loading], none when the song has no data. */
@Immutable
data class WaveformData(
    val trackId: String? = null,
    val heights: List<Float> = emptyList(),
    val loading: Boolean = false,
)

/** Whether the player draws a waveform (web: flat bars while loading, the simple bar without data). */
val PlayerUiState.showsWaveform: Boolean
    get() = progressBarStyle == "waveform" && (waveform.loading || waveform.heights.isNotEmpty())

/**
 * Last reported position plus when it was reported, so the UI can advance it
 * smoothly between the engine's once-a-second progress events.
 */
@Immutable
data class PlaybackProgress(
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val playing: Boolean = false,
    val reportedAtMs: Long = 0,
) {
    /** Estimated position at [nowMs] (an `elapsedRealtime` timestamp). */
    fun positionAt(nowMs: Long): Long {
        val advanced = if (playing) positionMs + (nowMs - reportedAtMs).coerceAtLeast(0) else positionMs
        return if (durationMs > 0) advanced.coerceIn(0, durationMs) else advanced.coerceAtLeast(0)
    }
}

/**
 * Smoothly advancing playback position: re-read every frame while playing,
 * frozen while paused. Only the composable reading it recomposes.
 */
@Composable
fun rememberPlaybackPosition(progress: PlaybackProgress): State<Long> {
    val position = remember { mutableLongStateOf(progress.positionAt(SystemClock.elapsedRealtime())) }
    LaunchedEffect(progress) {
        position.longValue = progress.positionAt(SystemClock.elapsedRealtime())
        if (!progress.playing) return@LaunchedEffect
        while (true) {
            withFrameMillis { }
            position.longValue = progress.positionAt(SystemClock.elapsedRealtime())
        }
    }
    return position
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val repository: PlaybackRepository,
    private val sessionStarter: PlaybackStarter,
    private val castManager: CastManager,
    private val playbackSettingsRepository: PlaybackSettingsRepository,
    private val waveformRepository: WaveformRepository,
    private val castHandoff: CastPlaybackHandoff,
    private val remoteControl: SessionRemoteControl,
    private val messages: UserMessages,
) : ViewModel() {

    private val isStartingQueue = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val waveform = MutableStateFlow(WaveformData())

    private val coreState: StateFlow<PlayerUiState> = combine(
        repository.state,
        isStartingQueue,
        error,
        castManager.state,
        castManager.status,
    ) { playback, starting, errorMessage, cast, castStatus ->
        PlayerUiState(
            track = playback.track,
            previousTrack = playback.previousTrack,
            nextTrack = playback.nextTrack,
            isPlaying = when {
                cast.isConnected -> castStatus.isPlaying
                playback.isFollowing -> playback.remote?.isPlaying == true
                else -> playback.status == PlaybackStatus.PLAYING
            },
            isBuffering = playback.status == PlaybackStatus.BUFFERING,
            queueIndex = playback.queueIndex,
            queueLength = playback.queueLength,
            isShuffled = playback.isShuffled,
            repeatMode = playback.repeatMode,
            sourceName = playback.sourceName,
            sourceType = playback.sourceType,
            isStartingQueue = starting,
            error = errorMessage,
            cast = cast,
            castStatus = castStatus.takeIf { cast.isConnected },
        )
    }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUiState())

    val uiState: StateFlow<PlayerUiState> = combine(
        coreState,
        playbackSettingsRepository.settings,
        waveform,
    ) { state, settings, waveform ->
        state.copy(progressBarStyle = settings.progressBarStyle, waveform = waveform)
    }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUiState())

    /** Position updates, separate from [uiState] so only progress UI recomposes. */
    val progress: StateFlow<PlaybackProgress> = combine(
        repository.state,
        castManager.state,
        castManager.status,
    ) { playback, cast, castStatus ->
        if (cast.isConnected) {
            PlaybackProgress(
                positionMs = castStatus.positionMs,
                durationMs = castStatus.durationMs.takeIf { it > 0 } ?: playback.durationMs,
                playing = castStatus.isPlaying,
                reportedAtMs = SystemClock.elapsedRealtime(),
            )
        } else if (playback.isFollowing && playback.remote != null) {
            // The owner's position, reported by its session updates.
            val remote = playback.remote!!
            PlaybackProgress(
                positionMs = remote.positionMs,
                durationMs = playback.durationMs,
                playing = remote.isPlaying,
                reportedAtMs = remote.reportedAtElapsedMs,
            )
        } else {
            PlaybackProgress(
                positionMs = playback.positionMs,
                durationMs = playback.durationMs,
                playing = playback.status == PlaybackStatus.PLAYING,
                reportedAtMs = SystemClock.elapsedRealtime(),
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaybackProgress())

    init {
        repository.ensureBound()
        castManager.initialize()
        // App-scoped: moves the session to a Cast receiver and back.
        castHandoff.start()
        viewModelScope.launch {
            runCatching { playbackSettingsRepository.ensureLoaded() }
        }
        viewModelScope.launch {
            repository.state
                .map { it.track?.id }
                .distinctUntilChanged()
                .collect { songId ->
                    if (songId == null) {
                        waveform.value = WaveformData()
                        return@collect
                    }
                    // Flat bars while loading (web), then this song's heights.
                    waveform.value = WaveformData(trackId = songId, loading = true)
                    waveform.value = WaveformData(trackId = songId, heights = waveformRepository.heights(songId))
                }
        }
        viewModelScope.launch {
            repository.events.collect { event ->
                if (event is PlaybackEvent.PlaybackError) {
                    error.value = event.message
                }
            }
        }
    }

    fun togglePlayPause() {
        if (castManager.state.value.isConnected) {
            if (castManager.status.value.isPlaying) castManager.pause() else castManager.play()
            return
        }
        val playback = repository.state.value
        if (playback.isFollowing) {
            val sessionId = playback.sessionId ?: return
            remote("Couldn't control the other device") {
                if (playback.remote?.isPlaying == true) remoteControl.pause(sessionId) else remoteControl.play(sessionId)
            }
            return
        }
        viewModelScope.launch {
            if (playback.status == PlaybackStatus.PLAYING) repository.pause() else repository.play()
        }
    }

    /** Runs a remote-control command for the session owner, reporting failures. */
    private fun remote(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch { runCatching { block() }.onFailure { messages.failure(failure, it) } }
    }

    private fun followedSessionId(): String? = repository.state.value.takeIf { it.isFollowing }?.sessionId

    fun next() {
        if (castManager.state.value.isConnected) {
            castManager.next()
            return
        }
        followedSessionId()?.let { sessionId ->
            remote("Couldn't control the other device") { remoteControl.next(sessionId) }
            return
        }
        viewModelScope.launch { repository.nextTrack() }
    }

    fun previous(force: Boolean = false) {
        if (castManager.state.value.isConnected) {
            castManager.previous()
            return
        }
        followedSessionId()?.let { sessionId ->
            remote("Couldn't control the other device") { remoteControl.previous(sessionId) }
            return
        }
        viewModelScope.launch { repository.previousTrack(force) }
    }

    fun toggleShuffle() {
        viewModelScope.launch {
            repository.setShuffle(!repository.state.value.isShuffled)
        }
    }

    fun cycleRepeat() {
        val next = when (repository.state.value.repeatMode) {
            "off" -> "all"
            "all" -> "one"
            else -> "off"
        }
        viewModelScope.launch { repository.setRepeatMode(next) }
    }

    fun seekToFraction(fraction: Float) {
        val durationMs = progress.value.durationMs
        if (durationMs <= 0) return
        val positionMs = (fraction.coerceIn(0f, 1f) * durationMs).toLong()
        if (castManager.state.value.isConnected) {
            castManager.seek(positionMs)
            return
        }
        followedSessionId()?.let { sessionId ->
            remote("Couldn't control the other device") { remoteControl.seek(sessionId, positionMs) }
            return
        }
        viewModelScope.launch { repository.seek(positionMs) }
    }

    fun disconnectCast() {
        castManager.endSession()
    }

    fun startRandomPlayback(size: Int = 50) {
        if (isStartingQueue.value) return
        viewModelScope.launch {
            isStartingQueue.value = true
            error.value = null
            try {
                sessionStarter.startRandomQueue(size)
            } catch (e: Exception) {
                error.value = e.message ?: "Unable to start playback"
            } finally {
                isStartingQueue.value = false
            }
        }
    }

    fun dismissError() {
        error.value = null
    }
}
