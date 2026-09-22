package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.SongActionSheet
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailBackdrop
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.ContainerDownloadType
import com.ferrotune.feature.downloads.ui.ContainerDownloadAction
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadMenuItem
import com.ferrotune.core.network.generated.SmartPlaylistInfo

@Composable
fun SmartPlaylistDetailScreen(
    onBack: () -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onEditRules: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SmartPlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    var menuExpanded by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val selection = rememberSongSelectionState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val smartSource = state.smartPlaylist?.let {
        listOf(QueueSourceRequest(sourceType = "smartPlaylist", sourceId = it.id))
    }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onBack()
    }
    LaunchedEffect(state.materializedPlaylistId) {
        state.materializedPlaylistId?.let(onOpenPlaylist)
    }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = smartSource?.let { sources ->
                        {
                            actionsViewModel.loadAllIds(
                                sources = sources,
                                onLoaded = selection::replace,
                            )
                        }
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
    ) { padding ->
        val smartCover = state.smartPlaylist?.let { smartPlaylist ->
            state.serverUrl?.let {
                coverArtUrl(serverUrl = it, coverArtId = "sp-${smartPlaylist.id}", size = "medium")
            }
        }
        Box(modifier = Modifier.fillMaxSize()) {
            DetailBackdrop(
                color = Color(0x33A855F7),
                coverModel = smartCover,
                blurred = true,
            )
            when {
            state.loading && state.smartPlaylist == null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ShimmerBox(
                        modifier = Modifier.size(96.dp),
                        shape = MaterialTheme.shapes.medium,
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ShimmerBox(
                            modifier = Modifier
                                .width(160.dp)
                                .height(20.dp),
                        )
                        ShimmerBox(
                            modifier = Modifier
                                .width(120.dp)
                                .height(14.dp),
                        )
                    }
                }
                MediaRowSkeletonList(count = 8)
            }

            state.error != null && state.smartPlaylist == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                ErrorState(message = state.error!!, onRetry = viewModel::load)
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                state.smartPlaylist?.let { smartPlaylist ->
                    item {
                        SmartPlaylistHeader(
                            smartPlaylist = smartPlaylist,
                            serverUrl = state.serverUrl,
                            songCount = smartPlaylist.songCount?.toInt() ?: songs.itemCount,
                            totalDuration = songs.itemSnapshotList.items.sumOf { it.duration },
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                            topActions = {
                                ContainerDownloadAction(
                                    type = ContainerDownloadType.SMART_PLAYLIST,
                                    sourceId = smartPlaylist.id,
                                    name = smartPlaylist.name,
                                    coverArtId = null,
                                )
                                Box {
                                    IconButton(onClick = { menuExpanded = true }) {
                                        Icon(Icons.Filled.MoreVert, contentDescription = "More")
                                    }
                                    DropdownMenu(
                                        expanded = menuExpanded,
                                        onDismissRequest = { menuExpanded = false },
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("Shuffle") },
                                            onClick = {
                                                menuExpanded = false
                                                viewModel.play(shuffle = true)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Edit rules") },
                                            onClick = {
                                                menuExpanded = false
                                                onEditRules()
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Create playlist from this") },
                                            onClick = {
                                                menuExpanded = false
                                                viewModel.materialize()
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Delete smart playlist") },
                                            onClick = {
                                                menuExpanded = false
                                                showDeleteDialog = true
                                            },
                                        )
                                    }
                                }
                            },
                        )
                    }
                    item {
                        DetailActionBar(
                            onPlayAll = { viewModel.play() },
                            onShuffle = { viewModel.play(shuffle = true) },
                            playEnabled = songs.itemCount > 0,
                            actions = {
                                FilterPill(
                                    value = state.filter,
                                    onValueChange = viewModel::setFilter,
                                    placeholder = "Filter songs...",
                                    modifier = Modifier.weight(1f),
                                )
                                SortMenu(
                                    options = playlistSortOptions,
                                    selectedKey = state.sort,
                                    ascending = state.sortDir == "asc",
                                    onSelect = viewModel::selectSort,
                                    onToggleDirection = viewModel::toggleSortDir,
                                )
                            },
                        )
                    }
                }
                when {
                    songs.loadState.refresh is LoadState.Error -> item {
                        ErrorState(
                            message = (songs.loadState.refresh as LoadState.Error).error.message
                                ?: "Failed to load songs",
                            onRetry = { songs.retry() },
                        )
                    }

                    songs.itemCount == 0 && songs.loadState.refresh !is LoadState.Loading -> item {
                        EmptyState("No songs match these rules")
                    }

                    else -> items(
                        count = songs.itemCount,
                        key = songs.itemKey { it.id },
                    ) { index ->
                        val song = songs[index] ?: return@items
                        val flags = rememberSongFlags(
                            songId = song.id,
                            starred = song.starred != null,
                        )
                        var menuExpanded by remember { mutableStateOf(false) }
                        MediaRow(
                            title = song.title,
                            subtitle = listOfNotNull(song.artist, song.album)
                                .joinToString(" • "),
                            coverModel = inlineCoverModel(song.coverArtData),
                            coverSeed = song.id,
                            onClick = { viewModel.play(startSongId = song.id) },
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
                                            SongDownloadMenuItem(songId = song.id)
                                        },
                                    )
                                }
                            },
                        )
                    }
                }
                item {
                    PagingListFooter(isLoading = songs.loadState.append is LoadState.Loading)
                }
            }
        }
    }
    }

    state.playbackError?.let { message ->
        ConfirmDialog(
            title = "Playback failed",
            message = message,
            confirmLabel = "OK",
            onDismiss = viewModel::dismissPlaybackError,
            onConfirm = viewModel::dismissPlaybackError,
        )
    }

    if (showDeleteDialog) {
        ConfirmDialog(
            title = "Delete smart playlist",
            message = "Delete \"${state.smartPlaylist?.name ?: ""}\"?",
            onDismiss = { showDeleteDialog = false },
            onConfirm = {
                showDeleteDialog = false
                viewModel.deleteSmartPlaylist()
            },
        )
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
private fun SmartPlaylistHeader(
    smartPlaylist: SmartPlaylistInfo,
    serverUrl: String?,
    songCount: Int,
    totalDuration: Long,
    showBackButton: Boolean,
    onBack: () -> Unit,
    topActions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    DetailHeader(
        title = smartPlaylist.name,
        label = "Smart Playlist",
        subtitle = if (songCount > 0) {
            "${formatCount(songCount, "song")} • ${formatTotalDuration(totalDuration)}"
        } else {
            null
        },
        seed = smartPlaylist.id,
        showBackButton = showBackButton,
        onBack = onBack,
        topActions = topActions,
        coverModel = serverUrl?.let {
            coverArtUrl(serverUrl = it, coverArtId = "sp-${smartPlaylist.id}", size = "medium")
        },
    )
}
