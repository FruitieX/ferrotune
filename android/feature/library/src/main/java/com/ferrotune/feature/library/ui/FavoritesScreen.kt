package com.ferrotune.feature.library.ui

import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.waitFor
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.SegmentedTabs
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.media.queueTextFilter
import com.ferrotune.core.network.ViewSortConfig
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.FavoritesCounts
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
import kotlinx.coroutines.withTimeoutOrNull

/** Web `rgba(239,68,68,0.2)` favorites tint. */
private val FAVORITES_BACKDROP = Color(0x33EF4444)

/** Web `bg-linear-to-br from-red-500 to-red-800`. */
private val FAVORITES_ICON_GRADIENT = listOf(Color(0xFFEF4444), Color(0xFF991B1B))

enum class FavoritesTab {
    SONGS,
    ALBUMS,
    ARTISTS,
}

data class FavoritesUiState(
    val tab: FavoritesTab = FavoritesTab.SONGS,
    val filter: String = "",
    val songSort: SongSort = SongSort.TITLE,
    val songSortDir: SortDir = SortDir.ASC,
    val albumSort: AlbumSort = AlbumSort.NAME,
    val albumSortDir: SortDir = SortDir.ASC,
    val artistSort: ArtistSort = ArtistSort.NAME,
    val artistSortDir: SortDir = SortDir.ASC,
    val counts: FavoritesCounts? = null,
)

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewSortPreferences: ViewSortPreferencesRepository,
    private val messages: UserMessages,
) : ViewModel() {

    private val state = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")
    private val sortReady = MutableStateFlow(false)

    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.songSort }.distinctUntilChanged(),
        state.map { it.songSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.songs(sort = sort, sortDir = dir, starredOnly = true, filter = filter.ifBlank { null })
            }.flow
        }
        .cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> = combine(
        state.map { it.albumSort }.distinctUntilChanged(),
        state.map { it.albumSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.albums(sort = sort, sortDir = dir, starredOnly = true, filter = filter.ifBlank { null })
            }.flow
        }
        .cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> = combine(
        state.map { it.artistSort }.distinctUntilChanged(),
        state.map { it.artistSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artists(sort = sort, sortDir = dir, starredOnly = true, filter = filter.ifBlank { null })
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        loadCounts()
        viewModelScope.launch {
            withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { viewSortPreferences.ensureLoaded() }
            val songs = viewSortPreferences.config(
                ViewSortKey.FAVORITE_SONGS,
                ViewSortConfig(SongSort.TITLE.apiValue, SortDir.ASC.apiValue),
            )
            val albums = viewSortPreferences.config(
                ViewSortKey.FAVORITE_ALBUMS,
                ViewSortConfig(AlbumSort.NAME.apiValue, SortDir.ASC.apiValue),
            )
            val artists = viewSortPreferences.config(
                ViewSortKey.FAVORITE_ARTISTS,
                ViewSortConfig(ArtistSort.NAME.apiValue, SortDir.ASC.apiValue),
            )
            state.update {
                it.copy(
                    songSort = SongSort.fromApiValue(songs.field) ?: SongSort.TITLE,
                    songSortDir = SortDir.fromApiValue(songs.direction) ?: SortDir.ASC,
                    albumSort = AlbumSort.fromApiValue(albums.field) ?: AlbumSort.NAME,
                    albumSortDir = SortDir.fromApiValue(albums.direction) ?: SortDir.ASC,
                    artistSort = ArtistSort.fromApiValue(artists.field) ?: ArtistSort.NAME,
                    artistSortDir = SortDir.fromApiValue(artists.direction) ?: SortDir.ASC,
                )
            }
            sortReady.value = true
        }
    }

    fun loadCounts() {
        viewModelScope.launch {
            runCatching { repository.favoritesCounts() }
                .onSuccess { counts -> state.update { it.copy(counts = counts) } }
            // Counts are decorative; keep the previous values on failure.
        }
    }

    fun selectTab(tab: FavoritesTab) = state.update { it.copy(tab = tab) }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    /** Applies the sort key to whichever favorites tab is active. */
    fun selectSort(key: String) {
        when (state.value.tab) {
            FavoritesTab.SONGS -> SongSort.fromApiValue(key)?.let { sort ->
                state.update { s -> s.copy(songSort = sort) }
                persistSort(ViewSortKey.FAVORITE_SONGS)
            }

            FavoritesTab.ALBUMS -> AlbumSort.fromApiValue(key)?.let { sort ->
                state.update { s -> s.copy(albumSort = sort) }
                persistSort(ViewSortKey.FAVORITE_ALBUMS)
            }

            FavoritesTab.ARTISTS -> ArtistSort.fromApiValue(key)?.let { sort ->
                state.update { s -> s.copy(artistSort = sort) }
                persistSort(ViewSortKey.FAVORITE_ARTISTS)
            }
        }
    }

    /** Toggles the sort direction of whichever favorites tab is active. */
    fun toggleSortDirection() {
        state.update { current ->
            when (current.tab) {
                FavoritesTab.SONGS -> current.copy(songSortDir = current.songSortDir.opposite())
                FavoritesTab.ALBUMS -> current.copy(albumSortDir = current.albumSortDir.opposite())
                FavoritesTab.ARTISTS -> current.copy(artistSortDir = current.artistSortDir.opposite())
            }
        }
        persistSort(
            when (state.value.tab) {
                FavoritesTab.SONGS -> ViewSortKey.FAVORITE_SONGS
                FavoritesTab.ALBUMS -> ViewSortKey.FAVORITE_ALBUMS
                FavoritesTab.ARTISTS -> ViewSortKey.FAVORITE_ARTISTS
            },
        )
    }

    private fun persistSort(key: ViewSortKey) {
        val current = state.value
        val config = when (key) {
            ViewSortKey.FAVORITE_SONGS -> ViewSortConfig(current.songSort.apiValue, current.songSortDir.apiValue)
            ViewSortKey.FAVORITE_ALBUMS -> ViewSortConfig(current.albumSort.apiValue, current.albumSortDir.apiValue)
            ViewSortKey.FAVORITE_ARTISTS -> ViewSortConfig(current.artistSort.apiValue, current.artistSortDir.apiValue)
            else -> return
        }
        viewModelScope.launch { viewSortPreferences.setSort(key, config.field, config.direction) }
    }

    /**
     * Plays favorite songs exactly as listed (web: `favorites` source with the
     * song filter and sort), optionally starting at one song.
     */
    fun play(startSongId: String? = null, startIndex: Int = 0, shuffle: Boolean = false) {
        val current = state.value
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "favorites",
                        sourceName = "Favorites",
                        filters = queueTextFilter(current.filter),
                        sort = queueSort(current.songSort.apiValue, current.songSortDir.apiValue),
                        startSongId = startSongId,
                        startIndex = startIndex,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }
}

@OptIn(kotlinx.coroutines.FlowPreview::class)
private fun Flow<String>.debouncedFilter(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged()

private data class FavoritesSortMenuState(
    val options: List<SortOption>,
    val selectedKey: String,
    val ascending: Boolean,
)

private fun FavoritesUiState.sortMenuState(): FavoritesSortMenuState = when (tab) {
    FavoritesTab.SONGS -> FavoritesSortMenuState(SONG_SORT_OPTIONS, songSort.apiValue, songSortDir.isAscending())
    FavoritesTab.ALBUMS -> FavoritesSortMenuState(ALBUM_SORT_OPTIONS, albumSort.apiValue, albumSortDir.isAscending())
    FavoritesTab.ARTISTS -> FavoritesSortMenuState(ARTIST_SORT_OPTIONS, artistSort.apiValue, artistSortDir.isAscending())
}

/**
 * Web Favorites page: red heart header with counts, play/shuffle/search/⋯
 * action bar, "Songs (n) / Albums (n) / Artists (n)" tabs, then the list or
 * card grid for the active tab, all in one scroll.
 */
@Composable
fun FavoritesScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val albums = viewModel.albums.collectAsLazyPagingItems()
    val artists = viewModel.artists.collectAsLazyPagingItems()
    val actions = LocalMediaActions.current
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    var sortMenuOpen by remember { mutableStateOf(false) }
    val columns = gridColumns()

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = modifier,
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = {
                        actionsViewModel.loadAllIds(
                            sources = listOf(QueueSourceRequest(sourceType = "favorites", sourceId = null)),
                            onLoaded = selection::replace,
                        )
                    },
                    selectingAll = selectingAll,
                )
            }
        },
        bottomBar = {
            if (selection.isActive) {
                SongSelectionActionBar(
                    selectedIds = selection.selectedIds.toList(),
                    onClearSelection = selection::clear,
                    viewModel = actionsViewModel,
                )
            }
        },
    ) { padding ->
        val actionBar: @Composable () -> Unit = {
            DetailActionBar(
                onPlayAll = { viewModel.play() },
                onShuffle = { viewModel.play(shuffle = true) },
                playEnabled = (state.counts?.songs ?: 1L) > 0,
                actions = {
                    FilterPill(
                        value = state.filter,
                        onValueChange = viewModel::setFilter,
                        placeholder = when (state.tab) {
                            FavoritesTab.SONGS -> "Search songs..."
                            FavoritesTab.ALBUMS -> "Search albums..."
                            FavoritesTab.ARTISTS -> "Search artists..."
                        },
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { sortMenuOpen = true }) {
                        Icon(Icons.Filled.MoreHoriz, contentDescription = "Sort options")
                    }
                },
            )
        }
        val listState = rememberLazyListState()
        val actionBarPinned by rememberActionBarPinned(listState)
        Box(modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                item(key = "hero") {
                    DetailHero(backdropColor = FAVORITES_BACKDROP) {
                        DetailHeader(
                            title = "Favorites",
                            icon = Icons.Filled.Favorite,
                            iconGradient = FAVORITES_ICON_GRADIENT,
                            meta = state.counts?.let { formatCount(it.songs.toInt(), "song") },
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                item(key = "tabs") {
                    SegmentedTabs(
                        labels = listOf(
                            "Songs" + (state.counts?.let { " (${it.songs})" } ?: ""),
                            "Albums" + (state.counts?.let { " (${it.albums})" } ?: ""),
                            "Artists" + (state.counts?.let { " (${it.artists})" } ?: ""),
                        ),
                        selectedIndex = state.tab.ordinal,
                        onSelect = { index ->
                            selection.clear()
                            viewModel.selectTab(FavoritesTab.entries[index])
                        },
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
                    )
                }
                when (state.tab) {
                    FavoritesTab.SONGS -> {
                        item(key = "columns") { TrackListHeader() }
                        songPagingItems(
                            songs = songs,
                            nowPlaying = nowPlaying,
                            menu = songMenu,
                            selection = selection,
                            onPlay = { song, position -> viewModel.play(song.id, position) },
                            emptyMessage = if (state.filter.isBlank()) "No favorite songs yet" else "No songs match your search",
                            emptyIcon = Icons.Filled.Favorite,
                        )
                    }

                    FavoritesTab.ALBUMS -> pagedCardRows(
                        items = albums,
                        columns = columns,
                        keyPrefix = "albums",
                        emptyMessage = "No favorite albums yet",
                    ) { album ->
                        MediaCard(
                            title = album.name,
                            subtitle = albumSubtitle(album),
                            coverModel = coverModel(album.coverArtData, album.coverArt),
                            seed = album.name,
                            titleIcon = Icons.Filled.Album,
                            onClick = { actions.openAlbum(album.id) },
                            onLongClick = { collectionMenu.open(album.toCollectionTarget()) },
                            modifier = Modifier.weight(1f),
                        )
                    }

                    FavoritesTab.ARTISTS -> pagedCardRows(
                        items = artists,
                        columns = columns,
                        keyPrefix = "artists",
                        emptyMessage = "No favorite artists yet",
                    ) { artist ->
                        MediaCard(
                            title = artist.name,
                            subtitle = artistCounts(artist),
                            coverModel = coverModel(artist.coverArtData, artist.coverArt),
                            seed = artist.name,
                            circularCover = true,
                            titleIcon = Icons.Filled.Person,
                            onClick = { actions.openArtist(artist.id) },
                            onLongClick = { collectionMenu.open(artist.toCollectionTarget()) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
            PinnedActionBar(visible = actionBarPinned) { actionBar() }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { viewModel.play(it.id) },
        onStartSelection = { selection.select(it.id) },
    )
    CollectionMenuSheet(state = collectionMenu)
    if (sortMenuOpen) {
        val sort = state.sortMenuState()
        MediaActionSheet(
            expanded = true,
            onDismiss = { sortMenuOpen = false },
            actions = emptyList(),
            extraContent = {
                SortSheetSection(
                    options = sort.options,
                    selectedKey = sort.selectedKey,
                    ascending = sort.ascending,
                    onSelect = viewModel::selectSort,
                    onToggleDirection = viewModel::toggleSortDirection,
                )
            },
        )
    }
}
