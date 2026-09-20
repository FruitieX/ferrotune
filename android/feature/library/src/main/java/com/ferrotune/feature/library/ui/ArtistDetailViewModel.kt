package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackSessionStarter
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistDetail
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

enum class ArtistTab {
    ALBUMS,
    SONGS,
}

data class ArtistDetailUiState(
    val artist: ArtistDetail? = null,
    val serverUrl: String? = null,
    val tab: ArtistTab = ArtistTab.ALBUMS,
    val loading: Boolean = true,
    val error: String? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class ArtistDetailViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackSessionStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val artistId: String = checkNotNull(savedStateHandle["artistId"])

    private val state = MutableStateFlow(ArtistDetailUiState())
    val uiState: StateFlow<ArtistDetailUiState> = state.asStateFlow()

    val albums: Flow<PagingData<AlbumResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artistAlbums(artistId)
        }.flow.cachedIn(viewModelScope)

    val songs: Flow<PagingData<SongResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artistSongs(artistId)
        }.flow.cachedIn(viewModelScope)

    init {
        viewModelScope.launch {
            try {
                val artist = repository.artist(artistId).artist
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(artist = artist, serverUrl = serverUrl, loading = false) }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e.message ?: "Failed to load artist") }
            }
        }
    }

    fun selectTab(tab: ArtistTab) = state.update { it.copy(tab = tab) }

    fun play(startSongId: String? = null) {
        viewModelScope.launch {
            val artist = state.value.artist ?: return@launch
            try {
                sessionStarter.startArtist(artistId, artist.name, startSongId)
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}
