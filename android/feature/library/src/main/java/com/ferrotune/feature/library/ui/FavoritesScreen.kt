package com.ferrotune.feature.library.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import com.ferrotune.core.actions.CollectionMenuItems
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongRowMenu
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionState
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
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

enum class FavoritesTab {
    SONGS,
    ALBUMS,
    ARTISTS,
}

data class FavoritesUiState(
    val tab: FavoritesTab = FavoritesTab.SONGS,
    val playbackError: String? = null,
)

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = state.asStateFlow()

    val songs: Flow<PagingData<SongResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.songs(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.albums(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artists(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    fun selectTab(tab: FavoritesTab) = state.update { it.copy(tab = tab) }

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
            } else {
                TopAppBar(
                    title = { Text("Favorites") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            PrimaryTabRow(selectedTabIndex = state.tab.ordinal) {
                FavoritesTab.entries.forEach { tab ->
                    Tab(
                        selected = tab == state.tab,
                        onClick = {
                            selection.clear()
                            viewModel.selectTab(tab)
                        },
                        text = { Text(tab.label()) },
                    )
                }
            }
            when (state.tab) {
                FavoritesTab.SONGS -> PagedSongList(
                    items = viewModel.songs.collectAsLazyPagingItems(),
                    onPlaySong = viewModel::playSong,
                    onOpenSongRadio = onOpenSongRadio,
                    onAddToPlaylist = { addToPlaylistSongIds = listOf(it) },
                    selection = selection,
                )

                FavoritesTab.ALBUMS -> PagedAlbumGrid(
                    items = viewModel.albums.collectAsLazyPagingItems(),
                    onOpenAlbum = onOpenAlbum,
                )

                FavoritesTab.ARTISTS -> PagedArtistList(
                    items = viewModel.artists.collectAsLazyPagingItems(),
                    onOpenArtist = onOpenArtist,
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
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load songs",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
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
                            SongRowMenu(
                                expanded = menuExpanded,
                                onDismiss = { menuExpanded = false },
                                songId = song.id,
                                flags = flags,
                                onOpenSongRadio = { onOpenSongRadio(song.id) },
                                onStartSelection = selection?.let { { it.select(song.id) } },
                                extraItems = {
                                    if (onAddToPlaylist != null) {
                                        AddToPlaylistMenuItem(
                                            onClick = {
                                                menuExpanded = false
                                                onAddToPlaylist(song.id)
                                            },
                                        )
                                    }
                                    SongDownloadMenuItem(
                                        songId = song.id,
                                        onClick = { menuExpanded = false },
                                    )
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

@Composable
internal fun PagedAlbumGrid(
    items: LazyPagingItems<AlbumResponse>,
    onOpenAlbum: (String) -> Unit,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load albums",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
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
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        CollectionMenuItems(
                            target = CollectionTarget(
                                sourceType = CollectionSource.ALBUM,
                                sourceId = album.id,
                                name = album.name,
                            ),
                            onDismiss = { menuExpanded = false },
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun PagedArtistList(
    items: LazyPagingItems<ArtistResponse>,
    onOpenArtist: (String) -> Unit,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load artists",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
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
                        subtitle = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                        coverModel = inlineCoverModel(artist.coverArtData),
                        coverShape = CircleShape,
                        coverSeed = artist.id,
                        onClick = { onOpenArtist(artist.id) },
                        onLongClick = { menuExpanded = true },
                    )
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        CollectionMenuItems(
                            target = CollectionTarget(
                                sourceType = CollectionSource.ARTIST,
                                sourceId = artist.id,
                                name = artist.name,
                            ),
                            onDismiss = { menuExpanded = false },
                        )
                    }
                }
            }
            item {
                PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
            }
        }
    }
}
