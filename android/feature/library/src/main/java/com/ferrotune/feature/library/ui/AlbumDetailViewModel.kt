package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackSessionStarter
import com.ferrotune.core.network.generated.AlbumDetail
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AlbumDetailUiState(
    val album: AlbumDetail? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class AlbumDetailViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackSessionStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val albumId: String = checkNotNull(savedStateHandle["albumId"])

    private val state = MutableStateFlow(AlbumDetailUiState())
    val uiState: StateFlow<AlbumDetailUiState> = state.asStateFlow()

    val songs: Flow<PagingData<SongResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.albumSongs(albumId)
        }.flow.cachedIn(viewModelScope)

    init {
        viewModelScope.launch {
            try {
                val album = repository.album(albumId).album
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(album = album, serverUrl = serverUrl, loading = false) }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e.message ?: "Failed to load album") }
            }
        }
    }

    fun play(startSongId: String? = null) {
        viewModelScope.launch {
            val album = state.value.album ?: return@launch
            try {
                sessionStarter.startAlbum(albumId, album.name, startSongId)
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}
