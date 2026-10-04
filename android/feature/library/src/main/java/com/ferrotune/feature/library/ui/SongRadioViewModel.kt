package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
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
)

@HiltViewModel
class SongRadioViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val messages: UserMessages,
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

    fun play(startSongId: String? = null, startIndex: Int = 0, shuffle: Boolean = false) {
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_SONG_RADIO,
                        sourceId = seedSongId,
                        sourceName = state.value.seed?.let { "${it.title} Radio" },
                        startSongId = startSongId,
                        startIndex = startIndex,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    private companion object {
        const val SOURCE_TYPE_SONG_RADIO = "songRadio"
    }
}
