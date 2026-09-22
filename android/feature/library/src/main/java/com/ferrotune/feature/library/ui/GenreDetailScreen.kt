package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.SongActionSheet
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailBackdrop
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.theme.seedBackdropColor
import com.ferrotune.core.designsystem.theme.seedIconGradient
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadAction
import com.ferrotune.feature.library.data.SortDir
import com.ferrotune.feature.playlists.ui.AddToPlaylistAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.core.designsystem.components.PagingListFooter

@Composable
fun GenreDetailScreen(
    onBack: () -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: GenreDetailViewModel = hiltViewModel(),
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
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = {
                        actionsViewModel.loadAllIds(
                            sources = listOf(
                                QueueSourceRequest(
                                    sourceType = "genre",
                                    sourceId = viewModel.genre,
                                ),
                            ),
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
            DetailBackdrop(color = seedBackdropColor(viewModel.genre))
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    item {
                        DetailHeader(
                            title = viewModel.genre,
                            label = "Genre",
                            subtitle = "${formatCount(state.albumCount.toInt(), "album")} • " +
                                formatCount(state.songCount.toInt(), "song"),
                            icon = Icons.Filled.Tag,
                            iconGradient = seedIconGradient(viewModel.genre),
                            seed = viewModel.genre,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
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
                                    options = DETAIL_SONG_SORT_OPTIONS,
                                    selectedKey = state.sort,
                                    ascending = state.sortDir == SortDir.ASC,
                                    onSelect = viewModel::selectSort,
                                    onToggleDirection = viewModel::toggleSortDir,
                                )
                            },
                        )
                    }
                    when {
                        songs.loadState.refresh is LoadState.Error -> item {
                            ErrorState(
                                message = (songs.loadState.refresh as LoadState.Error).error.message
                                    ?: "Failed to load songs",
                                onRetry = { songs.retry() },
                            )
                        }

                        songs.loadState.refresh is LoadState.Loading && songs.itemCount == 0 -> item {
                            MediaRowSkeletonList(count = 8)
                        }

                        songs.itemCount == 0 -> item {
                            EmptyState("No songs in this genre")
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
                                onClick = { viewModel.play(song.id) },
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
                                    Box {
                                        SongFavoriteButton(songId = song.id, flags = flags)
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
                                        )
                                    }
                                    AddToPlaylistAction(songIds = listOf(song.id))
                                    SongDownloadAction(songId = song.id)
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
