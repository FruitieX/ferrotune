package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LibraryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SongRadioUiState(
    val seed: SongResponse? = null,
    val similar: List<SongResponse> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class SongRadioViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val seedSongId: String = checkNotNull(savedStateHandle["songId"])

    private val state = MutableStateFlow(SongRadioUiState())
    val uiState: StateFlow<SongRadioUiState> = state.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                val seed = repository.song(seedSongId).song
                val similar = repository.similarSongs(seedSongId).songs
                state.update { it.copy(seed = seed, similar = similar, loading = false) }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e.message ?: "Failed to load radio") }
            }
        }
    }

    fun play(startSongId: String? = null, shuffle: Boolean = false) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_SONG_RADIO,
                        sourceId = seedSongId,
                        sourceName = state.value.seed?.title,
                        startSongId = startSongId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private companion object {
        const val SOURCE_TYPE_SONG_RADIO = "songRadio"
    }
}
