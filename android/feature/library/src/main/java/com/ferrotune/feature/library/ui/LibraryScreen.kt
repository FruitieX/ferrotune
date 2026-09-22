package com.ferrotune.feature.library.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.ChipTab
import com.ferrotune.core.designsystem.components.ChipTabRow
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.PageTitle
import com.ferrotune.core.designsystem.components.inlineCoverModel
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
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.network.MATCH_ALL_SONGS_QUERY
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadMenuItem
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.feature.playlists.ui.AddToPlaylistMenuItem
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.SongSort

internal const val CUSTOM_SORT = "custom"

internal val SONG_SORT_OPTIONS = listOf(
    SortOption(SongSort.TITLE.apiValue, "Title"),
    SortOption(SongSort.ARTIST.apiValue, "Artist"),
    SortOption(SongSort.ALBUM.apiValue, "Album"),
    SortOption(SongSort.YEAR.apiValue, "Year"),
    SortOption(SongSort.DURATION.apiValue, "Duration"),
    SortOption(SongSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(SongSort.PLAY_COUNT.apiValue, "Play count"),
    SortOption(SongSort.LAST_PLAYED.apiValue, "Last played"),
)

internal val DETAIL_SONG_SORT_OPTIONS = listOf(
    SortOption(CUSTOM_SORT, "Custom order"),
    SortOption(SongSort.TITLE.apiValue, "Title"),
    SortOption(SongSort.ARTIST.apiValue, "Artist"),
    SortOption(SongSort.ALBUM.apiValue, "Album"),
    SortOption(SongSort.YEAR.apiValue, "Year"),
    SortOption(SongSort.DURATION.apiValue, "Duration"),
    SortOption(SongSort.DATE_ADDED.apiValue, "Date added"),
)

internal val ALBUM_SORT_OPTIONS = listOf(
    SortOption(AlbumSort.NAME.apiValue, "Name"),
    SortOption(AlbumSort.ARTIST.apiValue, "Artist"),
    SortOption(AlbumSort.YEAR.apiValue, "Year"),
    SortOption(AlbumSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(AlbumSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(AlbumSort.LAST_PLAYED.apiValue, "Last played"),
)

internal val ARTIST_SORT_OPTIONS = listOf(
    SortOption(ArtistSort.NAME.apiValue, "Name"),
    SortOption(ArtistSort.ALBUM_COUNT.apiValue, "Album count"),
    SortOption(ArtistSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(ArtistSort.LAST_PLAYED.apiValue, "Last played"),
)

@Composable
fun LibraryScreen(
    onOpenArtist: (String) -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenGenre: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
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
                    onSelectAll = if (state.tab == LibraryTab.SONGS) {
                        {
                            actionsViewModel.loadAllIds(
                                searchParams = SearchParams(
                                    query = MATCH_ALL_SONGS_QUERY,
                                    songSort = state.songSort.apiValue,
                                    songSortDir = state.songSortDir.apiValue,
                                ),
                                onLoaded = selection::replace,
                            )
                        }
                    } else {
                        null
                    },
                    selectingAll = selectingAll,
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.background),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .statusBarsPadding()
                            .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PageTitle("Library")
                        FilterPill(
                            value = state.filter,
                            onValueChange = viewModel::setFilter,
                            modifier = Modifier.weight(1f),
                        )
                        val sort = state.sortMenuState()
                        SortMenu(
                            options = sort.options,
                            selectedKey = sort.selectedKey,
                            ascending = sort.ascending,
                            onSelect = viewModel::selectSort,
                            onToggleDirection = viewModel::toggleSortDirection,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    ChipTabRow(
                        tabs = LIBRARY_TABS,
                        selectedIndex = state.tab.ordinal,
                        onSelect = { index ->
                            selection.clear()
                            viewModel.selectTab(LibraryTab.entries[index])
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (state.tab) {
                LibraryTab.SONGS -> SongsTab(
                    onPlaySong = viewModel::playSong,
                    onOpenSongRadio = onOpenSongRadio,
                    onAddToPlaylist = { addToPlaylistSongIds = listOf(it) },
                    items = viewModel.songs.collectAsLazyPagingItems(),
                    selection = selection,
                )

                LibraryTab.ALBUMS -> AlbumsTab(
                    onOpenAlbum = onOpenAlbum,
                    onOpenArtist = onOpenArtist,
                    items = viewModel.albums.collectAsLazyPagingItems(),
                )

                LibraryTab.ARTISTS -> ArtistsTab(
                    onOpenArtist = onOpenArtist,
                    items = viewModel.artists.collectAsLazyPagingItems(),
                )

                LibraryTab.GENRES -> GenresTab(
                    genres = state.genres,
                    loading = state.genresLoading,
                    error = state.genresError,
                    onRetry = viewModel::loadGenres,
                    onOpenGenre = onOpenGenre,
                )
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

private val LIBRARY_TABS = listOf(
    ChipTab("Albums", Icons.Filled.Album),
    ChipTab("Artists", Icons.Filled.Person),
    ChipTab("Songs", Icons.Filled.MusicNote),
    ChipTab("Genres", Icons.Filled.Label),
)

private data class SortMenuState(
    val options: List<SortOption>,
    val selectedKey: String,
    val ascending: Boolean,
)

private fun LibraryUiState.sortMenuState(): SortMenuState = when (tab) {
    LibraryTab.SONGS -> SortMenuState(SONG_SORT_OPTIONS, songSort.apiValue, songSortDir.isAscending())
    LibraryTab.ALBUMS -> SortMenuState(ALBUM_SORT_OPTIONS, albumSort.apiValue, albumSortDir.isAscending())
    LibraryTab.ARTISTS -> SortMenuState(ARTIST_SORT_OPTIONS, artistSort.apiValue, artistSortDir.isAscending())
    LibraryTab.GENRES -> SortMenuState(emptyList(), "", true)
}

internal fun com.ferrotune.feature.library.data.SortDir.isAscending(): Boolean =
    this == com.ferrotune.feature.library.data.SortDir.ASC

@Composable
private fun SongsTab(
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onAddToPlaylist: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<SongResponse>,
    selection: SongSelectionState,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load songs",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
                MediaRowSkeletonList(count = 10, modifier = Modifier.fillMaxSize())

            items.itemCount == 0 -> EmptyState("No songs found")

            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
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
                        isSelectionActive = selection.isActive,
                        isSelected = song.id in selection.selectedIds,
                        onToggleSelection = { selection.toggle(song.id) },
                        onLongClick = {
                            if (selection.isActive) {
                                selection.toggle(song.id)
                            } else {
                                menuExpanded = true
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
                                    onStartSelection = { selection.select(song.id) },
                                    extraContent = {
                                        AddToPlaylistMenuItem(
                                            onClick = { onAddToPlaylist(song.id) },
                                        )
                                        SongDownloadMenuItem(songId = song.id)
                                    },
                                )
                            }
                        },
                    )
                }
                item {
                    PagingListFooter(
                        isLoading = items.loadState.append is androidx.paging.LoadState.Loading,
                    )
                }
            }
        }
    }
}

@Composable
private fun AlbumsTab(
    onOpenAlbum: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<AlbumResponse>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load albums",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(150.dp),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(6) { MediaCardSkeleton(width = 150.dp) }
                }

            items.itemCount == 0 -> EmptyState("No albums found")

            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(
                    count = items.itemCount,
                    key = items.itemKey { it.id },
                ) { index ->
                    val album = items[index] ?: return@items
                    var menuExpanded by remember { mutableStateOf(false) }
                    Box {
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
                            onGoToArtist = { onOpenArtist(album.artistId) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ArtistsTab(
    onOpenArtist: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<ArtistResponse>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load artists",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
                MediaRowSkeletonList(count = 10, modifier = Modifier.fillMaxSize())

            items.itemCount == 0 -> EmptyState("No artists found")

            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(
                    count = items.itemCount,
                    key = items.itemKey { it.id },
                ) { index ->
                    val artist = items[index] ?: return@items
                    var menuExpanded by remember { mutableStateOf(false) }
                    Box {
                        MediaRow(
                            title = artist.name,
                            subtitle = artistCounts(artist),
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
                            subtitle = artistCounts(artist),
                            coverModel = inlineCoverModel(artist.coverArtData),
                        )
                    }
                }
                item {
                    PagingListFooter(
                        isLoading = items.loadState.append is androidx.paging.LoadState.Loading,
                    )
                }
            }
        }
    }
}

private fun artistCounts(artist: ArtistResponse): String {
    val albums = artist.albumCount ?: 0
    val songs = artist.songCount ?: 0
    return "$albums albums • $songs songs"
}

@Composable
private fun GenresTab(
    genres: List<GenreResponse>,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    onOpenGenre: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        error != null -> ErrorState(message = error, onRetry = onRetry, modifier = modifier)
        loading && genres.isEmpty() -> LoadingBox(modifier)
        genres.isEmpty() -> EmptyState("No genres found", modifier)
        else -> LazyColumn(modifier = modifier.fillMaxSize()) {
            items(genres, key = { it.value }) { genre ->
                MediaRow(
                    title = genre.value,
                    subtitle = "${genre.songCount} songs • ${genre.albumCount} albums",
                    coverModel = null,
                    coverSeed = genre.value,
                    onClick = { onOpenGenre(genre.value) },
                )
            }
        }
    }
}

@Composable
private fun LoadingBox(modifier: Modifier = Modifier) {
    MediaRowSkeletonList(count = 10, modifier = modifier.fillMaxSize())
}
