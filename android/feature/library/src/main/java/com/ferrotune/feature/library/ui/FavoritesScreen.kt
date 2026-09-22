package com.ferrotune.feature.library.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.paging.LoadState
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.CollectionActionSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionSheet
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionState
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailBackdrop
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.SegmentedTabs
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadMenuItem
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.feature.playlists.ui.AddToPlaylistMenuItem
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
    val playbackError: String? = null,
)

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")

    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.songSort }.distinctUntilChanged(),
        state.map { it.songSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.songs(
                    sort = sort,
                    sortDir = dir,
                    starredOnly = true,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> = combine(
        state.map { it.albumSort }.distinctUntilChanged(),
        state.map { it.albumSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.albums(
                    sort = sort,
                    sortDir = dir,
                    starredOnly = true,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> = combine(
        state.map { it.artistSort }.distinctUntilChanged(),
        state.map { it.artistSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artists(
                    sort = sort,
                    sortDir = dir,
                    starredOnly = true,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        loadCounts()
    }

    fun loadCounts() {
        viewModelScope.launch {
            try {
                state.update { it.copy(counts = repository.favoritesCounts()) }
            } catch (_: Exception) {
                // Counts are decorative; keep the previous values on failure.
            }
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
            FavoritesTab.SONGS -> SongSort.entries.firstOrNull { it.apiValue == key }
                ?.let { state.update { s -> s.copy(songSort = it) } }

            FavoritesTab.ALBUMS -> AlbumSort.entries.firstOrNull { it.apiValue == key }
                ?.let { state.update { s -> s.copy(albumSort = it) } }

            FavoritesTab.ARTISTS -> ArtistSort.entries.firstOrNull { it.apiValue == key }
                ?.let { state.update { s -> s.copy(artistSort = it) } }
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
    }

    fun playAll(shuffle: Boolean = false) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "favorites",
                        sourceName = "Favorites",
                        sort = queueSort("name", "asc"),
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun playSong(songId: String) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "favorites",
                        sourceName = "Favorites",
                        sort = queueSort("name", "asc"),
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

@OptIn(kotlinx.coroutines.FlowPreview::class)
private fun Flow<String>.debouncedFilter(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged()

private data class FavoritesSortMenuState(
    val options: List<SortOption>,
    val selectedKey: String,
    val ascending: Boolean,
)

private fun FavoritesUiState.sortMenuState(): FavoritesSortMenuState = when (tab) {
    FavoritesTab.SONGS -> FavoritesSortMenuState(
        SONG_SORT_OPTIONS,
        songSort.apiValue,
        songSortDir.isAscending(),
    )

    FavoritesTab.ALBUMS -> FavoritesSortMenuState(
        ALBUM_SORT_OPTIONS,
        albumSort.apiValue,
        albumSortDir.isAscending(),
    )

    FavoritesTab.ARTISTS -> FavoritesSortMenuState(
        ARTIST_SORT_OPTIONS,
        artistSort.apiValue,
        artistSortDir.isAscending(),
    )
}

@Composable
fun FavoritesScreen(
    onBack: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val snackbarHostState = remember { SnackbarHostState() }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val selection = rememberSongSelectionState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()

    LaunchedEffect(state.playbackError) {
        state.playbackError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissPlaybackError()
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = modifier,
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = if (state.tab == FavoritesTab.SONGS) {
                        {
                            actionsViewModel.loadAllIds(
                                sources = listOf(
                                    QueueSourceRequest(sourceType = "favorites", sourceId = null),
                                ),
                                onLoaded = selection::replace,
                            )
                        }
                    } else {
                        null
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
                    extraActions = { ids ->
                        SongSelectionAction(Icons.Filled.PlaylistAdd, "Playlist") {
                            addToPlaylistSongIds = ids
                        }
                        SongSelectionAction(Icons.Filled.Download, "Download") {
                            downloadViewModel.downloadSongs(ids)
                            selection.clear()
                        }
                    },
                    viewModel = actionsViewModel,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            DetailBackdrop(color = FAVORITES_BACKDROP, height = 300.dp)
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                // The header, action bar, and tabs are the first item of each
                // tab's scrolling list so they scroll away like the other
                // detail screens instead of pinning above the content.
                val header: @Composable () -> Unit = {
                    FavoritesDetailHeader(
                        state = state,
                        songs = songs,
                        showBackButton = !selection.isActive,
                        onBack = onBack,
                        onPlayAll = { viewModel.playAll() },
                        onShuffle = { viewModel.playAll(shuffle = true) },
                        onFilterChange = viewModel::setFilter,
                        onSelectSort = viewModel::selectSort,
                        onToggleSortDirection = viewModel::toggleSortDirection,
                        onSelectTab = { index ->
                            selection.clear()
                            viewModel.selectTab(FavoritesTab.entries[index])
                        },
                    )
                }
                when (state.tab) {
                    FavoritesTab.SONGS -> PagedSongList(
                        items = songs,
                        onPlaySong = viewModel::playSong,
                        onOpenSongRadio = onOpenSongRadio,
                        onAddToPlaylist = { addToPlaylistSongIds = listOf(it) },
                        selection = selection,
                        header = header,
                    )

                    FavoritesTab.ALBUMS -> PagedAlbumGrid(
                        items = viewModel.albums.collectAsLazyPagingItems(),
                        onOpenAlbum = onOpenAlbum,
                        header = header,
                    )

                    FavoritesTab.ARTISTS -> PagedArtistList(
                        items = viewModel.artists.collectAsLazyPagingItems(),
                        onOpenArtist = onOpenArtist,
                        header = header,
                    )
                }
            }
        }
    }

    addToPlaylistSongIds?.let { songIds ->
        AddToPlaylistDialog(
            songIds = songIds,
            onDismiss = { addToPlaylistSongIds = null },
            onAdded = {
                addToPlaylistSongIds = null
                selection.clear()
            },
        )
    }
}

@Composable
private fun FavoritesDetailHeader(
    state: FavoritesUiState,
    songs: LazyPagingItems<SongResponse>,
    showBackButton: Boolean,
    onBack: () -> Unit,
    onPlayAll: () -> Unit,
    onShuffle: () -> Unit,
    onFilterChange: (String) -> Unit,
    onSelectSort: (String) -> Unit,
    onToggleSortDirection: () -> Unit,
    onSelectTab: (Int) -> Unit,
) {
    DetailHeader(
        title = "Favorites",
        icon = Icons.Filled.Favorite,
        iconGradient = FAVORITES_ICON_GRADIENT,
        subtitle = state.counts?.let { counts ->
            val songsLoading = songs.loadState.refresh is LoadState.Loading &&
                songs.itemCount == 0
            when (state.tab) {
                FavoritesTab.SONGS -> if (songsLoading) {
                    null
                } else {
                    val totalDuration = songs.itemSnapshotList.items.sumOf { it.duration }
                    "${formatCount(counts.songs.toInt(), "song")} • " +
                        formatTotalDuration(totalDuration)
                }

                FavoritesTab.ALBUMS -> formatCount(counts.albums.toInt(), "album")
                FavoritesTab.ARTISTS -> formatCount(counts.artists.toInt(), "artist")
            }
        },
        seed = "favorites",
        showBackButton = showBackButton,
        onBack = onBack,
    )
    DetailActionBar(
        onPlayAll = onPlayAll,
        onShuffle = onShuffle,
        playEnabled = (state.counts?.songs ?: 1) > 0,
        actions = {
            FilterPill(
                value = state.filter,
                onValueChange = onFilterChange,
                placeholder = when (state.tab) {
                    FavoritesTab.SONGS -> "Search songs..."
                    FavoritesTab.ALBUMS -> "Search albums..."
                    FavoritesTab.ARTISTS -> "Search artists..."
                },
                modifier = Modifier.weight(1f),
            )
            val sort = state.sortMenuState()
            SortMenu(
                options = sort.options,
                selectedKey = sort.selectedKey,
                ascending = sort.ascending,
                onSelect = onSelectSort,
                onToggleDirection = onToggleSortDirection,
            )
        },
    )
    SegmentedTabs(
        labels = FavoritesTab.entries.map { tab ->
            val count = when (tab) {
                FavoritesTab.SONGS -> state.counts?.songs
                FavoritesTab.ALBUMS -> state.counts?.albums
                FavoritesTab.ARTISTS -> state.counts?.artists
            }
            if (count != null) "${tab.label()} ($count)" else tab.label()
        },
        selectedIndex = state.tab.ordinal,
        onSelect = onSelectTab,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

private fun FavoritesTab.label(): String = when (this) {
    FavoritesTab.SONGS -> "Songs"
    FavoritesTab.ALBUMS -> "Albums"
    FavoritesTab.ARTISTS -> "Artists"
}

@Composable
internal fun PagedSongList(
    items: LazyPagingItems<SongResponse>,
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onAddToPlaylist: ((String) -> Unit)? = null,
    selection: SongSelectionState? = null,
    header: (@Composable () -> Unit)? = null,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (header != null) {
            item { Column { header() } }
        }
        when {
            items.loadState.refresh is LoadState.Error -> item {
                ErrorState(
                    message = (items.loadState.refresh as LoadState.Error).error.message
                        ?: "Failed to load songs",
                    onRetry = { items.retry() },
                )
            }

            items.loadState.refresh is LoadState.Loading && items.itemCount == 0 -> item {
                MediaRowSkeletonList(count = 10)
            }

            items.itemCount == 0 -> item {
                EmptyState("No songs found")
            }

            else -> {
                items(
                    count = items.itemCount,
                    key = items.itemKey { it.id },
                ) { index ->
                    val song = items[index] ?: return@items
                    val flags = rememberSongFlags(
                        songId = song.id,
                        starred = song.starred != null,
                    )
                    var menuExpanded by remember { mutableStateOf(false) }
                    MediaRow(
                        title = song.title,
                        subtitle = listOfNotNull(song.artist, song.album).joinToString(" • "),
                        coverModel = inlineCoverModel(song.coverArtData),
                        coverSeed = song.id,
                        onClick = { onPlaySong(song.id) },
                        isSelectionActive = selection?.isActive == true,
                        isSelected = song.id in (selection?.selectedIds ?: emptySet()),
                        onToggleSelection = selection?.let { { it.toggle(song.id) } },
                        onLongClick = selection?.let { state ->
                            {
                                if (state.isActive) {
                                    state.toggle(song.id)
                                } else {
                                    menuExpanded = true
                                }
                            }
                        },
                        trailing = {
                            SongFavoriteButton(songId = song.id, flags = flags)
                            Box {
                                IconButton(onClick = { menuExpanded = true }) {
                                    Icon(Icons.Filled.MoreVert, contentDescription = "More")
                                }
                                SongActionSheet(
                                    expanded = menuExpanded,
                                    onDismiss = { menuExpanded = false },
                                    songId = song.id,
                                    flags = flags,
                                    title = song.title,
                                    subtitle = song.artist,
                                    coverModel = inlineCoverModel(song.coverArtData),
                                    onOpenSongRadio = { onOpenSongRadio(song.id) },
                                    onStartSelection = selection?.let { { it.select(song.id) } },
                                    extraContent = {
                                        if (onAddToPlaylist != null) {
                                            AddToPlaylistMenuItem(
                                                onClick = { onAddToPlaylist(song.id) },
                                            )
                                        }
                                        SongDownloadMenuItem(songId = song.id)
                                    },
                                )
                            }
                        },
                    )
                }
                item {
                    PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
                }
            }
        }
    }
}

@Composable
internal fun PagedAlbumGrid(
    items: LazyPagingItems<AlbumResponse>,
    onOpenAlbum: (String) -> Unit,
    header: (@Composable () -> Unit)? = null,
) {
    // With a header the grid is flush against the screen edges so the header
    // stays full-bleed like the other detail screens; each cell carries the
    // former 12dp gutter as padding instead.
    val fullBleed = header != null
    val cellPadding = if (fullBleed) 6.dp else 0.dp
    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp),
        contentPadding = if (fullBleed) PaddingValues(0.dp) else PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(if (fullBleed) 0.dp else 12.dp),
        verticalArrangement = Arrangement.spacedBy(if (fullBleed) 0.dp else 12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (header != null) {
            // A lazy grid item lays multiple root layouts on top of each other,
            // so the header's composables need a single container.
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column { header() }
            }
        }
        when {
            items.loadState.refresh is LoadState.Error -> item(
                span = { GridItemSpan(maxLineSpan) },
            ) {
                ErrorState(
                    message = (items.loadState.refresh as LoadState.Error).error.message
                        ?: "Failed to load albums",
                    onRetry = { items.retry() },
                )
            }

            items.loadState.refresh is LoadState.Loading && items.itemCount == 0 -> items(6) {
                MediaCardSkeleton(width = 150.dp, modifier = Modifier.padding(cellPadding))
            }

            items.itemCount == 0 -> item(
                span = { GridItemSpan(maxLineSpan) },
            ) {
                EmptyState("No albums found")
            }

            else -> items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val album = items[index] ?: return@items
                var menuExpanded by remember { mutableStateOf(false) }
                Box(modifier = Modifier.padding(cellPadding)) {
                    MediaCard(
                        title = album.name,
                        subtitle = album.artist,
                        seed = album.id,
                        coverModel = inlineCoverModel(album.coverArtData),
                        onClick = { onOpenAlbum(album.id) },
                        onLongClick = { menuExpanded = true },
                    )
                    CollectionActionSheet(
                        expanded = menuExpanded,
                        onDismiss = { menuExpanded = false },
                        target = CollectionTarget(
                            sourceType = CollectionSource.ALBUM,
                            sourceId = album.id,
                            name = album.name,
                        ),
                        title = album.name,
                        subtitle = album.artist,
                        coverModel = inlineCoverModel(album.coverArtData),
                    )
                }
            }
        }
    }
}

@Composable
internal fun PagedArtistList(
    items: LazyPagingItems<ArtistResponse>,
    onOpenArtist: (String) -> Unit,
    header: (@Composable () -> Unit)? = null,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (header != null) {
            item { Column { header() } }
        }
        when {
            items.loadState.refresh is LoadState.Error -> item {
                ErrorState(
                    message = (items.loadState.refresh as LoadState.Error).error.message
                        ?: "Failed to load artists",
                    onRetry = { items.retry() },
                )
            }

            items.loadState.refresh is LoadState.Loading && items.itemCount == 0 -> item {
                MediaRowSkeletonList(count = 10)
            }

            items.itemCount == 0 -> item {
                EmptyState("No artists found")
            }

            else -> {
                items(
                    count = items.itemCount,
                    key = items.itemKey { it.id },
                ) { index ->
                    val artist = items[index] ?: return@items
                    var menuExpanded by remember { mutableStateOf(false) }
                    Box {
                        MediaRow(
                            title = artist.name,
                            subtitle = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                            coverModel = inlineCoverModel(artist.coverArtData),
                            coverShape = CircleShape,
                            coverSeed = artist.id,
                            onClick = { onOpenArtist(artist.id) },
                            onLongClick = { menuExpanded = true },
                        )
                        CollectionActionSheet(
                            expanded = menuExpanded,
                            onDismiss = { menuExpanded = false },
                            target = CollectionTarget(
                                sourceType = CollectionSource.ARTIST,
                                sourceId = artist.id,
                                name = artist.name,
                            ),
                            title = artist.name,
                            subtitle = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                            coverModel = inlineCoverModel(artist.coverArtData),
                        )
                    }
                }
                item {
                    PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
                }
            }
        }
    }
}
