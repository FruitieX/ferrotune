package com.ferrotune.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackEvent
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.media.TrackInfo
import com.ferrotune.core.media.WaveformRepository
import com.ferrotune.core.media.cast.CastConnectionState
import com.ferrotune.core.media.cast.CastManager
import com.ferrotune.core.media.cast.CastMediaStatus
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

data class PlayerUiState(
    val track: TrackInfo? = null,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val queueIndex: Int = -1,
    val queueLength: Int = 0,
    val isShuffled: Boolean = false,
    val repeatMode: String = "off",
    val isStartingQueue: Boolean = false,
    val error: String? = null,
    val cast: CastConnectionState = CastConnectionState(),
    val castStatus: CastMediaStatus? = null,
    val progressBarStyle: String = "waveform",
    val waveformHeights: List<Float> = emptyList(),
) {
    val progressFraction: Float
        get() = if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val repository: PlaybackRepository,
    private val sessionStarter: PlaybackStarter,
    private val castManager: CastManager,
    private val playbackSettingsRepository: PlaybackSettingsRepository,
    private val waveformRepository: WaveformRepository,
) : ViewModel() {

    private var castQueueLoaded = false

    private val isStartingQueue = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val waveformHeights = MutableStateFlow<List<Float>>(emptyList())

    private val coreState: StateFlow<PlayerUiState> = combine(
        repository.state,
        isStartingQueue,
        error,
        castManager.state,
        castManager.status,
    ) { playback, starting, errorMessage, cast, castStatus ->
        PlayerUiState(
            track = playback.track,
            isPlaying = if (cast.isConnected) castStatus.isPlaying else playback.status == PlaybackStatus.PLAYING,
            isBuffering = playback.status == PlaybackStatus.BUFFERING,
            positionMs = if (cast.isConnected) castStatus.positionMs else playback.positionMs,
            durationMs = if (cast.isConnected) {
                castStatus.durationMs.takeIf { it > 0 } ?: playback.durationMs
            } else {
                playback.durationMs
            },
            queueIndex = playback.queueIndex,
            queueLength = playback.queueLength,
            isShuffled = playback.isShuffled,
            repeatMode = playback.repeatMode,
            isStartingQueue = starting,
            error = errorMessage,
            cast = cast,
            castStatus = castStatus.takeIf { cast.isConnected },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUiState())

    val uiState: StateFlow<PlayerUiState> = combine(
        coreState,
        playbackSettingsRepository.settings,
        waveformHeights,
    ) { state, settings, heights ->
        state.copy(
            progressBarStyle = settings.progressBarStyle,
            waveformHeights = heights,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUiState())

    init {
        repository.ensureBound()
        castManager.initialize()
        viewModelScope.launch {
            runCatching { playbackSettingsRepository.ensureLoaded() }
        }
        viewModelScope.launch {
            repository.state
                .map { it.track?.id }
                .distinctUntilChanged()
                .collect { songId ->
                    waveformHeights.value = if (songId == null) {
                        emptyList()
                    } else {
                        waveformRepository.heights(songId)
                    }
                }
        }
        viewModelScope.launch {
            castManager.state.collect { cast ->
                if (cast.isConnected && !castQueueLoaded) {
                    castQueueLoaded = true
                    loadCastQueue()
                } else if (!cast.isConnected) {
                    castQueueLoaded = false
                }
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
        viewModelScope.launch {
            if (uiState.value.isPlaying) repository.pause() else repository.play()
        }
    }

    fun next() {
        if (castManager.state.value.isConnected) {
            castManager.next()
            return
        }
        viewModelScope.launch { repository.nextTrack() }
    }

    fun previous() {
        if (castManager.state.value.isConnected) {
            castManager.previous()
            return
        }
        viewModelScope.launch { repository.previousTrack() }
    }

    fun toggleShuffle() {
        viewModelScope.launch {
            repository.setShuffle(!uiState.value.isShuffled)
        }
    }

    fun cycleRepeat() {
        val next = when (uiState.value.repeatMode) {
            "off" -> "all"
            "all" -> "one"
            else -> "off"
        }
        viewModelScope.launch { repository.setRepeatMode(next) }
    }

    fun seekToFraction(fraction: Float) {
        val durationMs = uiState.value.durationMs
        if (durationMs <= 0) return
        val positionMs = (fraction.coerceIn(0f, 1f) * durationMs).toLong()
        if (castManager.state.value.isConnected) {
            castManager.seek(positionMs)
            return
        }
        viewModelScope.launch { repository.seek(positionMs) }
    }

    fun disconnectCast() {
        castManager.endSession()
    }

    private suspend fun loadCastQueue() {
        val items = repository.castMediaItems()
        if (items.isEmpty()) return
        val playback = repository.state.value
        val index = items
            .indexOfFirst { it.songId == playback.track?.id }
            .takeIf { it >= 0 }
            ?: 0
        castManager.loadQueue(
            items = items,
            startIndex = index,
            startTimeMs = playback.positionMs,
            repeatMode = playback.repeatMode,
        )
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
