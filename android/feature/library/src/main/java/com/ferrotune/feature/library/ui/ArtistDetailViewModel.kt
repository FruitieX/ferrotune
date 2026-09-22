package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistDetail
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
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
    val filter: String = "",
    val sort: String = CUSTOM_SORT,
    val sortDir: SortDir = SortDir.ASC,
    val playbackError: String? = null,
)

@HiltViewModel
class ArtistDetailViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val artistId: String = checkNotNull(savedStateHandle["artistId"])

    private val state = MutableStateFlow(ArtistDetailUiState())
    val uiState: StateFlow<ArtistDetailUiState> = state.asStateFlow()

    val albums: Flow<PagingData<AlbumResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artistAlbums(artistId)
        }.flow.cachedIn(viewModelScope)

    private val filter = MutableStateFlow("")

    @OptIn(kotlinx.coroutines.FlowPreview::class)
    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.sort to it.sortDir }.distinctUntilChanged(),
        filter.debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged(),
    ) { (sort, sortDir), filter -> Triple(sort, sortDir, filter) }
        .flatMapLatest { (sort, sortDir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artistSongs(
                    artistId,
                    sort = SongSort.entries.firstOrNull { it.apiValue == sort },
                    sortDir = sortDir,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

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

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(key: String) = state.update { it.copy(sort = key) }

    fun toggleSortDir() = state.update { it.copy(sortDir = it.sortDir.opposite()) }

    fun play(startSongId: String? = null, shuffle: Boolean = false) {
        viewModelScope.launch {
            val artist = state.value.artist ?: return@launch
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "artist",
                        sourceId = artistId,
                        sourceName = artist.name,
                        sort = state.value.sort
                            .takeIf { it != CUSTOM_SORT }
                            ?.let { queueSort(it, state.value.sortDir.apiValue) },
                        startSongId = startSongId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun toggleStar() {
        val artist = state.value.artist ?: return
        viewModelScope.launch {
            try {
                val starred = artist.starred == null
                repository.setStarred(artistIds = listOf(artistId), starred = starred)
                val refreshed = repository.artist(artistId).artist
                state.update { it.copy(artist = refreshed) }
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Failed to update favorite") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}
