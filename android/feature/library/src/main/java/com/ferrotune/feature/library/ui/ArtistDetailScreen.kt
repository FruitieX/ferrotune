package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionState
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.LoadingState
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SongResponse

@Composable
fun ArtistDetailScreen(
    onBack: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ArtistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val albums = viewModel.albums.collectAsLazyPagingItems()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val snackbarHostState = remember { SnackbarHostState() }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val selection = rememberSongSelectionState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val artistSource = state.artist?.let {
        listOf(QueueSourceRequest(sourceType = "artist", sourceId = it.id))
    }

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
                    onSelectAll = if (state.tab == ArtistTab.SONGS) {
                        artistSource?.let { sources ->
                            {
                                actionsViewModel.loadAllIds(
                                    sources = sources,
                                    onLoaded = selection::replace,
                                )
                            }
                        }
                    } else {
                        null
                    },
                    selectingAll = selectingAll,
                )
            } else {
                TopAppBar(
                    title = {
                        Text(
                            text = state.artist?.name ?: "Artist",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
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
        when {
            state.loading -> LoadingState(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.error != null -> ErrorState(
                message = state.error ?: "Failed to load artist",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.artist != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                val artist = state.artist!!
                DetailHeader(
                    title = artist.name,
                    subtitle = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                    seed = artist.id,
                    circularCover = true,
                    coverModel = inlineCoverModel(artist.coverArtData)
                        ?: artist.coverArt?.let { id ->
                            state.serverUrl?.let { coverArtUrl(it, id, "medium") }
                        },
                    actions = {
                        Button(onClick = { viewModel.play() }) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Play")
                        }
                    },
                )
                PrimaryTabRow(selectedTabIndex = state.tab.ordinal) {
                    ArtistTab.entries.forEach { tab ->
                        Tab(
                            selected = tab == state.tab,
                            onClick = {
                                selection.clear()
                                viewModel.selectTab(tab)
                            },
                            text = { Text(if (tab == ArtistTab.ALBUMS) "Albums" else "Songs") },
                        )
                    }
                }
                when (state.tab) {
                    ArtistTab.ALBUMS -> ArtistAlbumGrid(
                        items = albums,
                        onOpenAlbum = onOpenAlbum,
                    )

                    ArtistTab.SONGS -> ArtistSongList(
                        items = songs,
                        onPlaySong = { viewModel.play(it) },
                        onOpenSongRadio = onOpenSongRadio,
                        selection = selection,
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
private fun ArtistAlbumGrid(
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

        items.itemCount == 0 -> EmptyState("No albums for this artist")

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
                MediaCard(
                    title = album.name,
                    subtitle = album.year?.toString(),
                    seed = album.id,
                    coverModel = inlineCoverModel(album.coverArtData),
                    onClick = { onOpenAlbum(album.id) },
                )
            }
        }
    }
}

@Composable
private fun ArtistSongList(
    items: LazyPagingItems<SongResponse>,
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    selection: SongSelectionState,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load songs",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
            MediaRowSkeletonList(count = 8, modifier = Modifier.fillMaxSize())

        items.itemCount == 0 -> EmptyState("No songs for this artist")

        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val song = items[index] ?: return@items
                MediaRow(
                    title = song.title,
                    subtitle = listOfNotNull(song.album, song.year?.toString())
                        .joinToString(" • "),
                    coverModel = inlineCoverModel(song.coverArtData),
                    onClick = { onPlaySong(song.id) },
                    isSelectionActive = selection.isActive,
                    isSelected = song.id in selection.selectedIds,
                    onToggleSelection = { selection.toggle(song.id) },
                    onLongClick = { selection.select(song.id) },
                    trailing = {
                        IconButton(onClick = { onOpenSongRadio(song.id) }) {
                            Icon(Icons.Filled.Radio, contentDescription = "Song radio")
                        }
                            AddToPlaylistAction(songIds = listOf(song.id))
                            SongDownloadAction(songId = song.id)
                    },
                )
            }
            item {
                PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
            }
        }
    }
}
