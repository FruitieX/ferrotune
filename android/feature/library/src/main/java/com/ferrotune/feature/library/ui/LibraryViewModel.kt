package com.ferrotune.feature.library.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.ViewMode
import com.ferrotune.core.network.ViewModeKey
import com.ferrotune.core.network.ViewModePreferencesRepository
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.waitFor
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryFilters
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonPrimitive

enum class LibraryTab {
    ALBUMS,
    ARTISTS,
    SONGS,
    GENRES,

    /** Folder browser; its state lives in [FilesViewModel]. */
    FILES,
}

data class LibraryUiState(
    val tab: LibraryTab = LibraryTab.ALBUMS,
    val filter: String = "",
    val songSort: SongSort = SongSort.TITLE,
    val songSortDir: SortDir = SortDir.ASC,
    val albumSort: AlbumSort = AlbumSort.NAME,
    val albumSortDir: SortDir = SortDir.ASC,
    val artistSort: ArtistSort = ArtistSort.NAME,
    val artistSortDir: SortDir = SortDir.ASC,
    val genres: List<GenreResponse> = emptyList(),
    val genresLoading: Boolean = false,
    val genresError: String? = null,
    /** Web advanced filters for the songs/albums/artists tabs; not persisted. */
    val filters: LibraryFilters = LibraryFilters.NONE,
)

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewPreferences: LibraryViewPreferencesRepository,
    private val messages: UserMessages,
    private val viewModePreferences: ViewModePreferencesRepository,
) : ViewModel() {

    /** Grid or list per collection tab (web toolbar toggle). */
    val viewModes: StateFlow<Map<ViewModeKey, ViewMode>> = viewModePreferences.modes

    fun setViewMode(key: ViewModeKey, list: Boolean) {
        viewModelScope.launch { viewModePreferences.setMode(key, if (list) ViewMode.LIST else ViewMode.GRID) }
    }

    private val state = MutableStateFlow(LibraryUiState())
    val uiState: StateFlow<LibraryUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")

    /** Paging waits for the stored sort so the first page isn't fetched twice. */
    private val sortReady = MutableStateFlow(false)

    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.songSort }.distinctUntilChanged(),
        state.map { it.songSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
        state.map { it.filters }.distinctUntilChanged(),
    ) { sort, dir, filter, filters -> PageKey(sort, dir, filter, filters) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter, filters) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.songs(sort = sort, sortDir = dir, filter = filter.ifBlank { null }, filters = filters)
            }.flow
        }
        .cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> = combine(
        state.map { it.albumSort }.distinctUntilChanged(),
        state.map { it.albumSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
        state.map { it.filters }.distinctUntilChanged(),
    ) { sort, dir, filter, filters -> PageKey(sort, dir, filter, filters) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter, filters) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.albums(sort = sort, sortDir = dir, filter = filter.ifBlank { null }, filters = filters)
            }.flow
        }
        .cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> = combine(
        state.map { it.artistSort }.distinctUntilChanged(),
        state.map { it.artistSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
        state.map { it.filters }.distinctUntilChanged(),
    ) { sort, dir, filter, filters -> PageKey(sort, dir, filter, filters) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter, filters) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artists(sort = sort, sortDir = dir, filter = filter.ifBlank { null }, filters = filters)
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        loadGenres()
        viewModelScope.launch {
            val config = withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { viewPreferences.ensureLoaded() }
                ?: viewPreferences.sort.value
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
            sortReady.value = true
        }
    }

    fun selectTab(tab: LibraryTab) = state.update { it.copy(tab = tab) }

    fun setFilters(filters: LibraryFilters) = state.update { it.copy(filters = filters) }

    fun saveAsSmartPlaylist(name: String, filters: LibraryFilters) {
        viewModelScope.launch {
            runCatching { repository.createSmartPlaylist(name.trim(), filters) }
                .onSuccess { messages.show("Smart playlist \"${it.name}\" created") }
                .onFailure { messages.failure("Couldn't create smart playlist", it) }
        }
    }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    /** Applies the sort key to whichever tab is active. */
    fun selectSort(key: String) {
        when (state.value.tab) {
            LibraryTab.SONGS -> SongSort.entries.firstOrNull { it.apiValue == key }
                ?.let(::selectSongSort)

            LibraryTab.ALBUMS -> AlbumSort.entries.firstOrNull { it.apiValue == key }
                ?.let(::selectAlbumSort)

            LibraryTab.ARTISTS -> ArtistSort.entries.firstOrNull { it.apiValue == key }
                ?.let(::selectArtistSort)

            LibraryTab.GENRES, LibraryTab.FILES -> Unit
        }
    }

    /** Toggles the sort direction of whichever tab is active. */
    fun toggleSortDirection() {
        when (state.value.tab) {
            LibraryTab.SONGS -> toggleSongSortDir()
            LibraryTab.ALBUMS -> toggleAlbumSortDir()
            LibraryTab.ARTISTS -> toggleArtistSortDir()
            LibraryTab.GENRES, LibraryTab.FILES -> Unit
        }
    }

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

    /**
     * Plays the songs tab from [songId], materialized server-side with the
     * same filter and sort as the list (web: `search` source while filtering,
     * `library` otherwise).
     */
    fun playSong(songId: String, position: Int) {
        val current = state.value
        viewModelScope.launch {
            runCatching {
                // With "Apply search terms to queues" off, play the whole library from the song.
                val query = current.filter.trim().takeIf { sessionStarter.appliesSearchTermsToQueue() }.orEmpty()
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = if (query.isEmpty()) "library" else "search",
                        sourceName = if (query.isEmpty()) "Library" else "Search: $query",
                        filters = mapOf("query" to JsonPrimitive(query.ifEmpty { "*" })) +
                            current.filters.toQueueFilters(),
                        sort = queueSort(current.songSort.apiValue, current.songSortDir.apiValue),
                        startIndex = position,
                        startSongId = songId,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

}

/** Paging inputs for one library tab. */
private data class PageKey<S>(val sort: S, val dir: SortDir, val filter: String, val filters: LibraryFilters)

internal fun SortDir.opposite(): SortDir = if (this == SortDir.ASC) SortDir.DESC else SortDir.ASC

/**
 * Debounces typing in the library filter without delaying the initial empty
 * value, so the first page still loads immediately.
 */
@OptIn(kotlinx.coroutines.FlowPreview::class)
private fun Flow<String>.debouncedFilter(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged()
