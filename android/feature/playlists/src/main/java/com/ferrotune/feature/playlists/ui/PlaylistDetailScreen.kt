package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.formatDuration
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.feature.downloads.ui.ContainerDownloadType
import com.ferrotune.feature.downloads.ui.ContainerDownloadAction
import com.ferrotune.core.network.generated.PlaylistSongEntry

private val playlistSortOptions = listOf(
    SortOption("custom", "Custom order"),
    SortOption("name", "Title"),
    SortOption("artist", "Artist"),
    SortOption("album", "Album"),
    SortOption("dateAdded", "Date added"),
    SortOption("duration", "Duration"),
)

@Composable
fun PlaylistDetailScreen(
    onBack: () -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val entries = viewModel.entries.collectAsLazyPagingItems()
    var menuExpanded by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf(false) }
    var showAddSongs by remember { mutableStateOf(false) }
    var showShareDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onBack()
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(state.playlist?.name ?: "Playlist") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    SortMenu(
                        options = playlistSortOptions,
                        selectedKey = state.sort,
                        ascending = state.sortDir == "asc",
                        onSelect = viewModel::selectSort,
                        onToggleDirection = viewModel::toggleSortDir,
                    )
                    state.playlist?.let { playlist ->
                        ContainerDownloadAction(
                            type = ContainerDownloadType.PLAYLIST,
                            sourceId = playlist.id,
                            name = playlist.name,
                            coverArtId = playlist.coverArt,
                        )
                    }
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(
                            expanded = menuExpanded,
                            onDismissRequest = { menuExpanded = false },
                        ) {
                            if (state.playlist?.canEdit == true) {
                                DropdownMenuItem(
                                    text = { Text("Edit details") },
                                    onClick = {
                                        menuExpanded = false
                                        showEditDialog = true
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Add songs") },
                                    onClick = {
                                        menuExpanded = false
                                        showAddSongs = true
                                    },
                                )
                            }
                            if (state.playlist?.canEdit == true) {
                                DropdownMenuItem(
                                    text = { Text("Sharing") },
                                    onClick = {
                                        menuExpanded = false
                                        showShareDialog = true
                                        viewModel.loadShares()
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Delete playlist") },
                                onClick = {
                                    menuExpanded = false
                                    showDeleteDialog = true
                                },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading && state.playlist == null -> Column(
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

            state.error != null && state.playlist == null -> Box(
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
                state.playlist?.let { playlist ->
                    item {
                        PlaylistHeader(
                            playlist = playlist,
                            serverUrl = state.serverUrl,
                            onPlay = { viewModel.play() },
                        )
                    }
                }
                when {
                    entries.loadState.refresh is LoadState.Error -> item {
                        ErrorState(
                            message = (entries.loadState.refresh as LoadState.Error).error.message
                                ?: "Failed to load entries",
                            onRetry = { entries.retry() },
                        )
                    }

                    entries.itemCount == 0 && entries.loadState.refresh !is LoadState.Loading -> item {
                        EmptyState("This playlist is empty")
                    }

                    else -> items(
                        count = entries.itemCount,
                        key = entries.itemKey { it.entryId },
                    ) { index ->
                        val entry = entries[index] ?: return@items
                        PlaylistEntryRow(
                            entry = entry,
                            onPlay = { entry.song?.let { viewModel.play(startSongId = it.id) } },
                            onOpenSongRadio = { entry.song?.let { onOpenSongRadio(it.id) } },
                            onMoveUp = {
                                viewModel.moveEntry(entry, maxOf(0, entry.position - 1))
                            },
                            onMoveDown = {
                                viewModel.moveEntry(entry, entry.position + 1)
                            },
                            onRemove = { viewModel.removeEntry(entry) },
                            canEdit = state.playlist?.canEdit == true,
                        )
                    }
                }
                item {
                    PagingListFooter(isLoading = entries.loadState.append is LoadState.Loading)
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

    if (showEditDialog && state.playlist != null) {
        PlaylistEditDialog(
            initialName = state.playlist!!.name,
            initialComment = state.playlist!!.comment.orEmpty(),
            initialPublic = state.playlist!!.public,
            onDismiss = { showEditDialog = false },
            onConfirm = { name, comment, public ->
                viewModel.updateDetails(
                    name = name,
                    comment = comment.ifBlank { null },
                    public = public,
                )
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
        PlaylistSharesDialog(
            viewModel = viewModel,
            onDismiss = { showShareDialog = false },
        )
    }

    if (showDeleteDialog) {
        ConfirmDialog(
            title = "Delete playlist",
            message = "Delete \"${state.playlist?.name ?: ""}\"?",
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
    playlist: com.ferrotune.core.network.generated.PlaylistSongsResponse,
    serverUrl: String?,
    onPlay: () -> Unit,
) {
    DetailHeader(
        title = playlist.name,
        subtitle = playlist.comment?.takeIf { it.isNotBlank() },
        seed = playlist.id,
        coverModel = serverUrl
            ?.takeIf { playlist.matchedCount > 0 }
            ?.let { coverArtUrl(serverUrl = it, coverArtId = playlist.id, size = "medium") },
        badges = {
            Text(
                text = buildString {
                    append("${playlist.matchedCount} songs")
                    if (playlist.missingCount > 0) append(" • ${playlist.missingCount} missing")
                    if (playlist.duration > 0) append(" • ${formatDuration(playlist.duration)}")
                    val owners = listOfNotNull(
                        playlist.owner,
                        if (playlist.public) "Public" else null,
                        if (playlist.sharedWithMe) "Shared with me" else null,
                    ).joinToString(" • ")
                    if (owners.isNotBlank()) append(" • $owners")
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        actions = {
            Button(onClick = onPlay) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Play")
            }
        },
    )
}

@Composable
private fun PlaylistEntryRow(
    entry: PlaylistSongEntry,
    onPlay: () -> Unit,
    onOpenSongRadio: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit,
    canEdit: Boolean,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    val song = entry.song

    if (song != null) {
        MediaRow(
            title = song.title,
            subtitle = listOfNotNull(song.artist, song.album).joinToString(" • "),
            coverModel = inlineCoverModel(song.coverArtData),
            onClick = onPlay,
            trailing = {
                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "Entry menu")
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Play") },
                            onClick = {
                                menuExpanded = false
                                onPlay()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Song radio") },
                            onClick = {
                                menuExpanded = false
                                onOpenSongRadio()
                            },
                        )
                        if (canEdit) {
                            DropdownMenuItem(
                                text = { Text("Move up") },
                                onClick = {
                                    menuExpanded = false
                                    onMoveUp()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Move down") },
                                onClick = {
                                    menuExpanded = false
                                    onMoveDown()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Remove") },
                                onClick = {
                                    menuExpanded = false
                                    onRemove()
                                },
                            )
                        }
                    }
                }
            },
        )
    } else {
        val missing = entry.missing
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(24.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = missing?.title ?: "Missing track",
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = listOfNotNull(missing?.artist, missing?.album)
                        .joinToString(" • ")
                        .ifBlank { "No longer in the library" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (canEdit) {
                TextButton(onClick = onRemove) {
                    Text("Remove")
                }
            }
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
                        message = (results.loadState.refresh as LoadState.Error).error.message
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
