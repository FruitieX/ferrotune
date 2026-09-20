package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.feature.playlists.data.PlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SmartPlaylistDetailUiState(
    val smartPlaylist: SmartPlaylistInfo? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val deleted: Boolean = false,
    val materializedPlaylistId: String? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class SmartPlaylistDetailViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    private val sessionStarter: PlaybackStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val smartPlaylistId: String = checkNotNull(savedStateHandle["smartPlaylistId"])

    private val state = MutableStateFlow(SmartPlaylistDetailUiState())
    val uiState: StateFlow<SmartPlaylistDetailUiState> = state.asStateFlow()

    val songs: Flow<PagingData<SongResponse>> =
        Pager(PagingConfig(pageSize = DEFAULT_PAGE_SIZE)) {
            repository.smartPlaylistSongs(smartPlaylistId)
        }.flow.cachedIn(viewModelScope)

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val smartPlaylist = repository.smartPlaylist(smartPlaylistId)
                val serverUrl = repository.activeServerUrl()
                state.update {
                    it.copy(smartPlaylist = smartPlaylist, serverUrl = serverUrl, loading = false)
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load smart playlist")
                }
            }
        }
    }

    fun play(startSongId: String? = null, shuffle: Boolean = false) {
        val smartPlaylist = state.value.smartPlaylist ?: return
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_SMART_PLAYLIST,
                        sourceId = smartPlaylist.id,
                        sourceName = smartPlaylist.name,
                        startSongId = startSongId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun materialize() {
        viewModelScope.launch {
            try {
                val response = repository.materializeSmartPlaylist(smartPlaylistId)
                state.update { it.copy(materializedPlaylistId = response.playlistId) }
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Failed to create playlist") }
            }
        }
    }

    fun deleteSmartPlaylist() {
        viewModelScope.launch {
            try {
                repository.deleteSmartPlaylist(smartPlaylistId)
                state.update { it.copy(deleted = true) }
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Failed to delete smart playlist") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private companion object {
        const val SOURCE_TYPE_SMART_PLAYLIST = "smartPlaylist"
    }
}
