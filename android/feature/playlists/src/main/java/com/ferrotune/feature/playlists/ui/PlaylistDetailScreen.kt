package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongListRow
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.coverUrl
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.TrackRowHeight
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.readableMessage
import com.ferrotune.feature.downloads.ui.ContainerDownloadMenuItem
import com.ferrotune.feature.downloads.ui.ContainerDownloadType
import com.ferrotune.feature.playlists.data.PlaylistRepository

internal val playlistSortOptions = listOf(
    SortOption("custom", "Custom order"),
    SortOption("name", "Title"),
    SortOption("artist", "Artist"),
    SortOption("album", "Album"),
    SortOption("dateAdded", "Date added"),
    SortOption("duration", "Duration"),
)

/** Web playlist header tile: `from-emerald-500 to-emerald-800`. */
private val PlaylistIconGradient = listOf(Color(0xFF10B981), Color(0xFF065F46))

/**
 * Web playlist page: emerald header (cover mosaic, owner/counts/duration),
 * play/shuffle/filter/⋯ action bar, then the numbered entries including
 * "not found" rows for missing tracks. Editing (rename, add songs, sharing,
 * delete, reorder, remove) lives in the ⋯ and row menus when allowed.
 */
@Composable
fun PlaylistDetailScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val entries = viewModel.entries.collectAsLazyPagingItems()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val playlistMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    var menuEntry by remember { mutableStateOf<PlaylistSongEntry?>(null) }
    var showEditDialog by remember { mutableStateOf(false) }
    var showAddSongs by remember { mutableStateOf(false) }
    var showShareDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    val playlist = state.playlist
    val canEdit = playlist?.canEdit == true
    val customOrder = state.sort == PlaylistRepository.PLAYLIST_SORT_CUSTOM && state.filter.isBlank()

    fun loadedEntriesForSelection(): List<PlaylistSongEntry> {
        val selectedIds = selection.selectedIds
        if (selectedIds.isEmpty()) return emptyList()
        return (0 until entries.itemCount).mapNotNull { index ->
            entries.peek(index)?.takeIf { it.song?.id in selectedIds }
        }
    }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onBack()
    }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = playlist?.let {
                        {
                            actionsViewModel.loadAllIds(
                                sources = listOf(
                                    com.ferrotune.core.network.generated.QueueSourceRequest(
                                        sourceType = "playlist",
                                        sourceId = it.id,
                                    ),
                                ),
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
                    extraActions = {
                        if (canEdit) {
                            SongSelectionAction(Icons.Filled.Delete, "Remove") {
                                viewModel.removeEntries(loadedEntriesForSelection())
                                selection.clear()
                            }
                        }
                    },
                    viewModel = actionsViewModel,
                )
            }
        },
    ) { padding ->
        val actionBar: @Composable () -> Unit = {
            DetailActionBar(
                onPlayAll = { viewModel.play() },
                onShuffle = { viewModel.play(shuffle = true) },
                playEnabled = (playlist?.matchedCount ?: 0) > 0,
                actions = {
                    FilterPill(
                        value = state.filter,
                        onValueChange = viewModel::setFilter,
                        placeholder = "Filter playlist...",
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            playlist?.let {
                                playlistMenu.open(
                                    CollectionTarget(
                                        sourceType = CollectionSource.PLAYLIST,
                                        sourceId = it.id,
                                        name = it.name,
                                        subtitle = formatCount(it.matchedCount.toInt(), "song"),
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
                    DetailHero(
                        backdropColor = Color(0x3310B981),
                        coverModel = playlist?.takeIf { it.matchedCount > 0 }?.let { coverUrl(it.id) },
                        blurredCover = true,
                    ) {
                        PlaylistHeader(
                            playlist = playlist,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                val refresh = entries.loadState.refresh
                when {
                    state.error != null && playlist == null -> item(key = "error") {
                        ErrorState(message = state.error!!, onRetry = viewModel::load)
                    }

                    refresh is LoadState.Error && entries.itemCount == 0 -> item(key = "entries-error") {
                        ErrorState(
                            message = refresh.error.readableMessage() ?: "Failed to load entries",
                            onRetry = entries::retry,
                        )
                    }

                    refresh is LoadState.Loading && entries.itemCount == 0 -> item(key = "loading") {
                        MediaRowSkeletonList(count = 8)
                    }

                    entries.itemCount == 0 -> item(key = "empty") {
                        if (state.filter.isNotBlank()) {
                            EmptyState("No songs match your filter")
                        } else {
                            EmptyState(
                                message = "This playlist is empty",
                                icon = Icons.AutoMirrored.Filled.QueueMusic,
                                description = if (canEdit) "Add songs from the ⋯ menu or any song's menu." else null,
                            )
                        }
                    }

                    else -> {
                        item(key = "columns") { TrackListHeader() }
                        items(
                            count = entries.itemCount,
                            key = entries.itemKey { it.entryId },
                            contentType = { "entry" },
                        ) { index ->
                            val entry = entries[index] ?: return@items
                            val song = entry.song
                            if (song != null) {
                                SongListRow(
                                    song = song,
                                    nowPlaying = nowPlaying,
                                    menu = songMenu,
                                    selection = selection,
                                    index = entry.position + 1,
                                    onPlay = {
                                        viewModel.play(
                                            startSongId = song.id,
                                            startIndex = entry.songIndex ?: index,
                                        )
                                    },
                                    onLongPress = { menuEntry = entry },
                                )
                            } else {
                                MissingEntryRow(
                                    entry = entry,
                                    canEdit = canEdit,
                                    onRemove = { viewModel.removeEntry(entry) },
                                )
                            }
                        }
                        item(key = "footer") {
                            PagingListFooter(isLoading = entries.loadState.append is LoadState.Loading)
                        }
                    }
                }
            }
            PinnedActionBar(visible = actionBarPinned) { actionBar() }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { target ->
            val entry = menuEntry?.takeIf { it.song?.id == target.id }
            viewModel.play(startSongId = target.id, startIndex = entry?.songIndex ?: 0)
        },
        onStartSelection = { selection.select(it.id) },
        extraActions = { target ->
            val entry = menuEntry?.takeIf { it.song?.id == target.id }
            if (!canEdit || entry == null) {
                emptyList()
            } else {
                buildList {
                    if (customOrder) {
                        add(
                            MediaAction("Move up", Icons.Filled.KeyboardArrowUp) {
                                viewModel.moveEntry(entry, maxOf(0, entry.position - 1))
                            },
                        )
                        add(
                            MediaAction("Move down", Icons.Filled.KeyboardArrowDown) {
                                viewModel.moveEntry(entry, entry.position + 1)
                            },
                        )
                    }
                    add(
                        MediaAction("Remove from playlist", Icons.Filled.Delete, destructive = true) {
                            viewModel.removeEntry(entry)
                        },
                    )
                }
            }
        },
    )
    CollectionMenuSheet(
        state = playlistMenu,
        extraActions = {
            if (!canEdit) {
                emptyList()
            } else {
                listOf(
                    MediaAction("Add songs", Icons.Filled.Add, separatorBefore = true) { showAddSongs = true },
                    MediaAction("Edit details", Icons.Filled.Edit) { showEditDialog = true },
                    MediaAction("Sharing", Icons.Filled.Share) {
                        showShareDialog = true
                        viewModel.loadShares()
                    },
                    MediaAction("Delete playlist", Icons.Filled.Delete, destructive = true) {
                        showDeleteDialog = true
                    },
                )
            }
        },
        extraContent = { target ->
            ContainerDownloadMenuItem(
                type = ContainerDownloadType.PLAYLIST,
                sourceId = target.sourceId,
                name = target.name.orEmpty(),
                coverArtId = playlist?.coverArt,
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

    if (showEditDialog && playlist != null) {
        PlaylistEditDialog(
            initialName = playlist.name,
            initialComment = playlist.comment.orEmpty(),
            initialPublic = playlist.public,
            onDismiss = { showEditDialog = false },
            onConfirm = { name, comment, public ->
                viewModel.updateDetails(name = name, comment = comment.ifBlank { null }, public = public)
                showEditDialog = false
            },
        )
    }

    if (showAddSongs) {
        AddSongsDialog(
            onDismiss = { showAddSongs = false },
            onAdd = { songIds ->
                viewModel.addSongs(songIds)
                showAddSongs = false
            },
        )
    }

    if (showShareDialog) {
        PlaylistSharesDialog(viewModel = viewModel, onDismiss = { showShareDialog = false })
    }

    if (showDeleteDialog) {
        ConfirmDialog(
            title = "Delete playlist",
            message = "Delete \"${playlist?.name.orEmpty()}\"?",
            onDismiss = { showDeleteDialog = false },
            onConfirm = {
                showDeleteDialog = false
                viewModel.deletePlaylist()
            },
        )
    }
}

@Composable
private fun PlaylistHeader(
    playlist: PlaylistSongsResponse?,
    showBackButton: Boolean,
    onBack: () -> Unit,
) {
    DetailHeader(
        title = playlist?.name.orEmpty(),
        label = "Playlist",
        subtitle = playlist?.comment?.takeIf { it.isNotBlank() },
        meta = playlist?.let {
            buildList {
                add(it.owner)
                if (it.sharedWithMe) add("Shared with you")
                add(formatCount(it.matchedCount.toInt(), "song"))
                if (it.missingCount > 0) add("${it.missingCount} not found")
                if (it.duration > 0) add(formatTotalDuration(it.duration))
            }.joinToString(" • ")
        },
        seed = playlist?.name,
        coverModel = playlist?.takeIf { it.matchedCount > 0 }?.let { coverUrl(it.id) },
        coverPlaceholder = Icons.AutoMirrored.Filled.QueueMusic,
        showBackButton = showBackButton,
        onBack = onBack,
    )
}

/** Web `MissingEntryRow`: a warning row for a track no longer in the library. */
@Composable
private fun MissingEntryRow(
    entry: PlaylistSongEntry,
    canEdit: Boolean,
    onRemove: () -> Unit,
) {
    val missing = entry.missing
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = TrackRowHeight)
            .padding(start = 16.dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = (entry.position + 1).toString(),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(28.dp),
            maxLines = 1,
        )
        Icon(
            Icons.Filled.Warning,
            contentDescription = "Not found",
            tint = Color(0xFFF59E0B),
            modifier = Modifier.size(20.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = missing?.title ?: "Missing track",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = listOfNotNull(missing?.artist, missing?.album)
                    .joinToString(" • ")
                    .ifBlank { "No longer in the library" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (canEdit) {
            TextButton(onClick = onRemove) { Text("Remove") }
        }
    }
}

@Composable
private fun PlaylistEditDialog(
    initialName: String,
    initialComment: String,
    initialPublic: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String, String, Boolean) -> Unit,
) {
    var name by remember { mutableStateOf(initialName) }
    var comment by remember { mutableStateOf(initialComment) }
    var isPublic by remember { mutableStateOf(initialPublic) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit playlist") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Comment") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Switch(checked = isPublic, onCheckedChange = { isPublic = it })
                    Text("Public")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name.trim(), comment.trim(), isPublic) },
                enabled = name.isNotBlank(),
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun PlaylistSharesDialog(
    viewModel: PlaylistDetailViewModel,
    onDismiss: () -> Unit,
) {
    val state by viewModel.shares.collectAsStateWithLifecycle()

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sharing") },
        text = {
            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                state.users.isEmpty() -> Text("No other users on this server")
                else -> LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                    items(state.users, key = { it.id }) { user ->
                        val shared = state.shares.containsKey(user.id)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = shared,
                                onCheckedChange = { viewModel.toggleShare(user.id) },
                            )
                            Text(
                                text = user.username,
                                modifier = Modifier.weight(1f),
                            )
                            if (shared) {
                                Text("Edit", style = MaterialTheme.typography.bodySmall)
                                Switch(
                                    checked = state.shares[user.id] == true,
                                    onCheckedChange = {
                                        viewModel.setShareCanEdit(user.id, it)
                                    },
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    viewModel.saveShares()
                    onDismiss()
                },
                enabled = !state.loading,
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
internal fun AddSongsDialog(
    onDismiss: () -> Unit,
    onAdd: (List<String>) -> Unit,
    viewModel: SongPickerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val results = viewModel.results.collectAsLazyPagingItems()
    var selected by remember { mutableStateOf(setOf<String>()) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add songs") },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = viewModel::onQueryChange,
                    label = { Text("Search") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                when {
                    state.query.isBlank() -> Text(
                        text = "Type to search your library",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )

                    results.loadState.refresh is LoadState.Error -> ErrorState(
                        message = (results.loadState.refresh as LoadState.Error).error.readableMessage()
                            ?: "Search failed",
                        onRetry = { results.retry() },
                    )

                    else -> LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 320.dp),
                    ) {
                        items(
                            count = results.itemCount,
                            key = results.itemKey { it.id },
                        ) { index ->
                            val song = results[index] ?: return@items
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = song.id in selected,
                                    onCheckedChange = {
                                        selected = if (song.id in selected) {
                                            selected - song.id
                                        } else {
                                            selected + song.id
                                        }
                                    },
                                )
                                Text(
                                    text = song.title,
                                    style = MaterialTheme.typography.bodyLarge,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                        item {
                            PagingListFooter(
                                isLoading = results.loadState.append is LoadState.Loading,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onAdd(selected.toList()) },
                enabled = selected.isNotEmpty(),
            ) {
                Text("Add (${selected.size})")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
