package com.ferrotune.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackEvent
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.media.TrackInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
    val isStartingQueue: Boolean = false,
    val error: String? = null,
) {
    val progressFraction: Float
        get() = if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val repository: PlaybackRepository,
    private val sessionStarter: PlaybackSessionStarter,
) : ViewModel() {

    private val isStartingQueue = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)

    val uiState: StateFlow<PlayerUiState> = combine(
        repository.state,
        isStartingQueue,
        error,
    ) { playback, starting, errorMessage ->
        PlayerUiState(
            track = playback.track,
            isPlaying = playback.status == PlaybackStatus.PLAYING,
            isBuffering = playback.status == PlaybackStatus.BUFFERING,
            positionMs = playback.positionMs,
            durationMs = playback.durationMs,
            queueIndex = playback.queueIndex,
            queueLength = playback.queueLength,
            isStartingQueue = starting,
            error = errorMessage,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUiState())

    init {
        repository.ensureBound()
        viewModelScope.launch {
            repository.events.collect { event ->
                if (event is PlaybackEvent.PlaybackError) {
                    error.value = event.message
                }
            }
        }
    }

    fun togglePlayPause() {
        viewModelScope.launch {
            if (uiState.value.isPlaying) repository.pause() else repository.play()
        }
    }

    fun next() {
        viewModelScope.launch { repository.nextTrack() }
    }

    fun previous() {
        viewModelScope.launch { repository.previousTrack() }
    }

    fun seekToFraction(fraction: Float) {
        val durationMs = uiState.value.durationMs
        if (durationMs <= 0) return
        viewModelScope.launch {
            repository.seek((fraction.coerceIn(0f, 1f) * durationMs).toLong())
        }
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
