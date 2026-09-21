package com.ferrotune.feature.library.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import com.ferrotune.core.actions.SongRowMenu
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionState
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.LoadingState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.feature.downloads.ui.ContainerDownloadAction
import com.ferrotune.feature.downloads.ui.ContainerDownloadType
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.SongDownloadMenuItem
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.feature.playlists.ui.AddToPlaylistMenuItem

@Composable
fun AlbumDetailScreen(
    onBack: () -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: AlbumDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val snackbarHostState = remember { SnackbarHostState() }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selection = rememberSongSelectionState()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val albumSource = state.album?.let {
        listOf(QueueSourceRequest(sourceType = "album", sourceId = it.id))
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
                    onSelectAll = albumSource?.let { sources ->
                        {
                            actionsViewModel.loadAllIds(
                                sources = sources,
                                onLoaded = selection::replace,
                            )
                        }
                    },
                    selectingAll = selectingAll,
                )
            } else {
                TopAppBar(
                title = {
                    Text(
                        text = state.album?.name ?: "Album",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    state.album?.let { album ->
                        ContainerDownloadAction(
                            type = ContainerDownloadType.ALBUM,
                            sourceId = album.id,
                            name = album.name,
                            coverArtId = album.coverArt,
                        )
                        Box {
                            IconButton(onClick = { menuExpanded = true }) {
                                Icon(Icons.Filled.MoreVert, contentDescription = "More")
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                val source = QueueSourceRequest(
                                    sourceType = "album",
                                    sourceId = album.id,
                                )
                                DropdownMenuItem(
                                    text = { Text("Play next") },
                                    leadingIcon = {
                                        Icon(Icons.Filled.PlaylistPlay, contentDescription = null)
                                    },
                                    onClick = {
                                        menuExpanded = false
                                        actionsViewModel.playNextSources(listOf(source))
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Add to queue") },
                                    leadingIcon = {
                                        Icon(Icons.Filled.Add, contentDescription = null)
                                    },
                                    onClick = {
                                        menuExpanded = false
                                        actionsViewModel.addSourcesToQueue(listOf(source))
                                    },
                                )
                            }
                        }
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
                message = state.error ?: "Failed to load album",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.album != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                val album = state.album!!
                DetailHeader(
                    title = album.name,
                    subtitle = album.artist,
                    seed = album.id,
                    onSubtitleClick = { onOpenArtist(album.artistId) },
                    coverModel = inlineCoverModel(album.coverArtData)
                        ?: album.coverArt?.let { id ->
                            state.serverUrl?.let { coverArtUrl(it, id, "large") }
                        },
                    badges = {
                        Text(
                            text = listOfNotNull(
                                album.year?.toString(),
                                "${album.songCount} songs",
                            ).joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    actions = {
                        Button(onClick = { viewModel.play() }) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Play")
                        }
                    },
                )
                AlbumSongList(
                    items = songs,
                    onPlaySong = { viewModel.play(it) },
                    onOpenSongRadio = onOpenSongRadio,
                    onAddToPlaylist = { addToPlaylistSongIds = listOf(it) },
                    selection = selection,
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

@Composable
private fun AlbumSongList(
    items: LazyPagingItems<com.ferrotune.core.network.generated.SongResponse>,
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onAddToPlaylist: (String) -> Unit,
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

        items.itemCount == 0 -> EmptyState("No songs on this album")

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
                    subtitle = listOfNotNull(
                        song.track?.toString()?.let { "Track $it" },
                        song.artist,
                    ).joinToString(" • "),
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
                            SongRowMenu(
                                expanded = menuExpanded,
                                onDismiss = { menuExpanded = false },
                                songId = song.id,
                                flags = flags,
                                onOpenSongRadio = { onOpenSongRadio(song.id) },
                                onStartSelection = { selection.select(song.id) },
                                extraItems = {
                                    AddToPlaylistMenuItem(
                                        onClick = {
                                            menuExpanded = false
                                            onAddToPlaylist(song.id)
                                        },
                                    )
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
