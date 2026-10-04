package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.coverUrl
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.ContainerDownloadMenuItem
import com.ferrotune.feature.downloads.ui.ContainerDownloadType

/** Web smart playlist header tile: `from-purple-500 to-fuchsia-700`. */
private val SmartIconGradient = listOf(Color(0xFFA855F7), Color(0xFFA21CAF))

/**
 * Web smart playlist page: header, play/shuffle/filter/⋯ (edit rules, save
 * as playlist, delete, download, sort), and the matching songs.
 */
@Composable
fun SmartPlaylistDetailScreen(
    onBack: () -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onEditRules: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SmartPlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val smartMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    var showDeleteDialog by remember { mutableStateOf(false) }
    val smart = state.smartPlaylist

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
                    onSelectAll = smart?.let {
                        {
                            actionsViewModel.loadAllIds(
                                sources = listOf(QueueSourceRequest(sourceType = "smartPlaylist", sourceId = it.id)),
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
                    viewModel = actionsViewModel,
                )
            }
        },
    ) { padding ->
        val actionBar: @Composable () -> Unit = {
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
                    IconButton(
                        onClick = {
                            smart?.let {
                                smartMenu.open(
                                    CollectionTarget(
                                        sourceType = CollectionSource.SMART_PLAYLIST,
                                        sourceId = it.id,
                                        name = it.name,
                                        subtitle = "Smart playlist",
                                    ),
                                )
                            }
                        },
                    ) {
                        Icon(Icons.Filled.MoreHoriz, contentDescription = "More options")
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
                    DetailHero(backdropColor = Color(0x33A855F7)) {
                        DetailHeader(
                            title = smart?.name.orEmpty(),
                            label = "Smart Playlist",
                            subtitle = smart?.comment?.takeIf { it.isNotBlank() },
                            meta = smart?.songCount?.let { formatCount(it.toInt(), "song") },
                            seed = smart?.let { "smart-${it.id}" },
                            coverModel = smart?.let { coverUrl("sp-${it.id}") },
                            coverPlaceholder = Icons.Filled.AutoAwesome,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                if (state.error != null && smart == null) {
                    item(key = "error") { ErrorState(message = state.error!!, onRetry = viewModel::load) }
                } else {
                    if (songs.itemCount > 0 || songs.loadState.refresh is LoadState.Loading) {
                        item(key = "columns") { TrackListHeader() }
                    }
                    songPagingItems(
                        songs = songs,
                        nowPlaying = nowPlaying,
                        menu = songMenu,
                        selection = selection,
                        onPlay = { song, position -> viewModel.play(song.id, position) },
                        emptyMessage = if (state.filter.isBlank()) "No songs match these rules" else "No songs match your filter",
                        emptyIcon = Icons.Filled.AutoAwesome,
                    )
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
    CollectionMenuSheet(
        state = smartMenu,
        extraActions = {
            listOf(
                MediaAction("Edit rules", Icons.Filled.Edit, separatorBefore = true, onClick = onEditRules),
                MediaAction("Save as playlist", Icons.AutoMirrored.Filled.PlaylistAdd) { viewModel.materialize() },
                MediaAction("Delete smart playlist", Icons.Filled.Delete, destructive = true) {
                    showDeleteDialog = true
                },
            )
        },
        extraContent = { target ->
            ContainerDownloadMenuItem(
                type = ContainerDownloadType.SMART_PLAYLIST,
                sourceId = target.sourceId,
                name = target.name.orEmpty(),
                coverArtId = null,
            )
            SortSheetSection(
                options = playlistSortOptions,
                selectedKey = state.sort,
                ascending = state.sortDir == "asc",
                onSelect = viewModel::selectSort,
                onToggleDirection = viewModel::toggleSortDir,
            )
        },
    )

    if (showDeleteDialog) {
        ConfirmDialog(
            title = "Delete smart playlist",
            message = "Delete \"${smart?.name.orEmpty()}\"?",
            onDismiss = { showDeleteDialog = false },
            onConfirm = {
                showDeleteDialog = false
                viewModel.deleteSmartPlaylist()
            },
        )
    }
}
