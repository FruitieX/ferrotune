package com.ferrotune.feature.library.ui

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
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.LibraryViewPreferencesRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class LibraryTab {
    ARTISTS,
    ALBUMS,
    SONGS,
    GENRES,
}

data class LibraryUiState(
    val tab: LibraryTab = LibraryTab.SONGS,
    val songSort: SongSort = SongSort.TITLE,
    val songSortDir: SortDir = SortDir.ASC,
    val albumSort: AlbumSort = AlbumSort.NAME,
    val albumSortDir: SortDir = SortDir.ASC,
    val artistSort: ArtistSort = ArtistSort.NAME,
    val artistSortDir: SortDir = SortDir.ASC,
    val genres: List<GenreResponse> = emptyList(),
    val genresLoading: Boolean = false,
    val genresError: String? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewPreferences: LibraryViewPreferencesRepository,
) : ViewModel() {

    private val state = MutableStateFlow(LibraryUiState())
    val uiState: StateFlow<LibraryUiState> = state.asStateFlow()

    val songs: Flow<PagingData<SongResponse>> = state
        .map { it.songSort to it.songSortDir }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.songs(sort = sort, sortDir = dir)
            }.flow
        }
        .cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> = state
        .map { it.albumSort to it.albumSortDir }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.albums(sort = sort, sortDir = dir)
            }.flow
        }
        .cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> = state
        .map { it.artistSort to it.artistSortDir }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artists(sort = sort, sortDir = dir)
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        loadGenres()
        viewModelScope.launch {
            val config = viewPreferences.ensureLoaded()
            state.update {
                it.copy(
                    songSort = config.songSort(),
                    songSortDir = config.songDir(),
                    albumSort = config.albumSort(),
                    albumSortDir = config.albumDir(),
                    artistSort = config.artistSort(),
                    artistSortDir = config.artistDir(),
                )
            }
        }
    }

    fun selectTab(tab: LibraryTab) = state.update { it.copy(tab = tab) }

    fun selectSongSort(sort: SongSort) {
        state.update { it.copy(songSort = sort) }
        persistSongSort()
    }

    fun toggleSongSortDir() {
        state.update { it.copy(songSortDir = it.songSortDir.opposite()) }
        persistSongSort()
    }

    fun selectAlbumSort(sort: AlbumSort) {
        state.update { it.copy(albumSort = sort) }
        persistAlbumSort()
    }

    fun toggleAlbumSortDir() {
        state.update { it.copy(albumSortDir = it.albumSortDir.opposite()) }
        persistAlbumSort()
    }

    fun selectArtistSort(sort: ArtistSort) {
        state.update { it.copy(artistSort = sort) }
        persistArtistSort()
    }

    fun toggleArtistSortDir() {
        state.update { it.copy(artistSortDir = it.artistSortDir.opposite()) }
        persistArtistSort()
    }

    private fun persistSongSort() = viewModelScope.launch {
        val current = state.value
        viewPreferences.setSongSort(current.songSort, current.songSortDir)
    }

    private fun persistAlbumSort() = viewModelScope.launch {
        val current = state.value
        viewPreferences.setAlbumSort(current.albumSort, current.albumSortDir)
    }

    private fun persistArtistSort() = viewModelScope.launch {
        val current = state.value
        viewPreferences.setArtistSort(current.artistSort, current.artistSortDir)
    }

    fun loadGenres() {
        state.update { it.copy(genresLoading = true, genresError = null) }
        viewModelScope.launch {
            try {
                val genres = repository.genres()
                state.update { it.copy(genres = genres, genresLoading = false) }
            } catch (e: Exception) {
                state.update {
                    it.copy(genresLoading = false, genresError = e.message ?: "Failed to load genres")
                }
            }
        }
    }

    fun playSong(songId: String) {
        viewModelScope.launch {
            val current = state.value
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "library",
                        sourceName = "Songs",
                        sort = queueSort(
                            current.songSort.apiValue,
                            current.songSortDir.apiValue,
                        ),
                        startSongId = songId,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}

internal fun SortDir.opposite(): SortDir = if (this == SortDir.ASC) SortDir.DESC else SortDir.ASC
