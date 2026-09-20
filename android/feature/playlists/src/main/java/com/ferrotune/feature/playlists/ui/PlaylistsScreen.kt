package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.RecentPlaylistEntry
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.feature.playlists.data.PlaylistFolderNode

private sealed interface PlaylistsDialog {
    data class CreatePlaylist(val folderId: String?) : PlaylistsDialog
    data class CreateFolder(val parentId: String?) : PlaylistsDialog
    data class RenamePlaylist(val playlist: PlaylistInFolder) : PlaylistsDialog
    data class RenameFolder(val folder: PlaylistFolderResponse) : PlaylistsDialog
    data class MovePlaylist(val playlist: PlaylistInFolder) : PlaylistsDialog
    data class MoveFolder(val folder: PlaylistFolderResponse) : PlaylistsDialog
    data class DeletePlaylist(val playlist: PlaylistInFolder) : PlaylistsDialog
    data class DeleteFolder(val folder: PlaylistFolderResponse) : PlaylistsDialog
}

@Composable
fun PlaylistsScreen(
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlaylistsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<PlaylistsDialog?>(null) }
    var addMenuExpanded by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Playlists") },
                actions = {
                    IconButton(onClick = { addMenuExpanded = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "Add")
                    }
                    DropdownMenu(
                        expanded = addMenuExpanded,
                        onDismissRequest = { addMenuExpanded = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("New playlist") },
                            onClick = {
                                addMenuExpanded = false
                                dialog = PlaylistsDialog.CreatePlaylist(folderId = null)
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("New folder") },
                            onClick = {
                                addMenuExpanded = false
                                dialog = PlaylistsDialog.CreateFolder(parentId = null)
                            },
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { dialog = PlaylistsDialog.CreatePlaylist(folderId = null) }) {
                Icon(Icons.Filled.Add, contentDescription = "New playlist")
            }
        },
    ) { padding ->
        when {
            state.loading && state.tree.folders.isEmpty() && state.tree.rootPlaylists.isEmpty() ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

            state.error != null -> Box(
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
                contentPadding = PaddingValues(bottom = 96.dp),
            ) {
                if (state.recentlyPlayed.isNotEmpty()) {
                    item {
                        SectionHeader("Recently played")
                    }
                    item {
                        RecentPlaylistsRow(
                            entries = state.recentlyPlayed,
                            serverUrl = state.serverUrl,
                            onOpenPlaylist = onOpenPlaylist,
                            onOpenSmartPlaylist = onOpenSmartPlaylist,
                        )
                    }
                }
                if (state.smartPlaylists.isNotEmpty()) {
                    item {
                        SectionHeader("Smart playlists")
                    }
                    items(state.smartPlaylists, key = { "smart-${it.id}" }) { smart ->
                        SmartPlaylistRow(
                            smartPlaylist = smart,
                            serverUrl = state.serverUrl,
                            onOpen = { onOpenSmartPlaylist(smart.id) },
                            onPlay = { viewModel.playSmartPlaylist(smart, shuffle = false) },
                            onShuffle = { viewModel.playSmartPlaylist(smart, shuffle = true) },
                        )
                    }
                }
                if (state.tree.rootPlaylists.isNotEmpty() || state.tree.folders.isNotEmpty()) {
                    item {
                        SectionHeader("Your library")
                    }
                }
                items(state.tree.rootPlaylists, key = { it.id }) { playlist ->
                    PlaylistRow(
                        playlist = playlist,
                        serverUrl = state.serverUrl,
                        onOpen = { onOpenPlaylist(playlist.id) },
                        onPlay = { viewModel.playPlaylist(playlist, shuffle = false) },
                        onShuffle = { viewModel.playPlaylist(playlist, shuffle = true) },
                        onRename = { dialog = PlaylistsDialog.RenamePlaylist(playlist) },
                        onMove = { dialog = PlaylistsDialog.MovePlaylist(playlist) },
                        onDelete = { dialog = PlaylistsDialog.DeletePlaylist(playlist) },
                    )
                }
                folderNodes(
                    nodes = state.tree.folders,
                    serverUrl = state.serverUrl,
                    onOpenPlaylist = onOpenPlaylist,
                    onPlayPlaylist = { viewModel.playPlaylist(it, shuffle = false) },
                    onShufflePlaylist = { viewModel.playPlaylist(it, shuffle = true) },
                    onRenamePlaylist = { dialog = PlaylistsDialog.RenamePlaylist(it) },
                    onMovePlaylist = { dialog = PlaylistsDialog.MovePlaylist(it) },
                    onDeletePlaylist = { dialog = PlaylistsDialog.DeletePlaylist(it) },
                    onCreatePlaylist = { dialog = PlaylistsDialog.CreatePlaylist(it.folder.id) },
                    onCreateFolder = { dialog = PlaylistsDialog.CreateFolder(it.folder.id) },
                    onRenameFolder = { dialog = PlaylistsDialog.RenameFolder(it) },
                    onMoveFolder = { dialog = PlaylistsDialog.MoveFolder(it) },
                    onDeleteFolder = { dialog = PlaylistsDialog.DeleteFolder(it) },
                )
                if (state.tree.rootPlaylists.isEmpty() &&
                    state.tree.folders.isEmpty() &&
                    state.smartPlaylists.isEmpty()
                ) {
                    item {
                        EmptyState("No playlists yet")
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

    when (val active = dialog) {
        is PlaylistsDialog.CreatePlaylist -> NameDialog(
            title = "New playlist",
            confirmLabel = "Create",
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.createPlaylist(it, active.folderId)
                dialog = null
            },
        )

        is PlaylistsDialog.CreateFolder -> NameDialog(
            title = "New folder",
            confirmLabel = "Create",
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.createFolder(it, active.parentId)
                dialog = null
            },
        )

        is PlaylistsDialog.RenamePlaylist -> NameDialog(
            title = "Rename playlist",
            initialValue = active.playlist.name,
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.renamePlaylist(active.playlist.id, it)
                dialog = null
            },
        )

        is PlaylistsDialog.RenameFolder -> NameDialog(
            title = "Rename folder",
            initialValue = active.folder.name,
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.renameFolder(active.folder.id, it)
                dialog = null
            },
        )

        is PlaylistsDialog.MovePlaylist -> FolderPickerDialog(
            title = "Move ${active.playlist.name}",
            nodes = state.tree.folders,
            onDismiss = { dialog = null },
            onSelect = { folderId ->
                viewModel.movePlaylist(active.playlist.id, folderId)
                dialog = null
            },
        )

        is PlaylistsDialog.MoveFolder -> FolderPickerDialog(
            title = "Move ${active.folder.name}",
            nodes = state.tree.folders,
            excludeIds = subtreeIds(state.tree.folders, active.folder.id),
            onDismiss = { dialog = null },
            onSelect = { parentId ->
                viewModel.moveFolder(active.folder.id, parentId)
                dialog = null
            },
        )

        is PlaylistsDialog.DeletePlaylist -> ConfirmDialog(
            title = "Delete playlist",
            message = "Delete \"${active.playlist.name}\"?",
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.deletePlaylist(active.playlist.id)
                dialog = null
            },
        )

        is PlaylistsDialog.DeleteFolder -> ConfirmDialog(
            title = "Delete folder",
            message = "Delete \"${active.folder.name}\"? Playlists inside move to the root.",
            onDismiss = { dialog = null },
            onConfirm = {
                viewModel.deleteFolder(active.folder.id)
                dialog = null
            },
        )

        null -> Unit
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
private fun RecentPlaylistsRow(
    entries: List<RecentPlaylistEntry>,
    serverUrl: String?,
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(entries, key = { "${it.playlistType}-${it.id}" }) { entry ->
            val isSmart = entry.playlistType == "smartPlaylist"
            Column(
                modifier = Modifier
                    .width(120.dp)
                    .clickable {
                        if (isSmart) onOpenSmartPlaylist(entry.id) else onOpenPlaylist(entry.id)
                    },
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CoverArt(
                    model = serverUrl?.let {
                        coverArtUrl(
                            serverUrl = it,
                            coverArtId = if (isSmart) "sp-${entry.id}" else entry.id,
                            size = "small",
                        )
                    },
                    contentDescription = entry.name,
                    modifier = Modifier.size(120.dp),
                )
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                )
            }
        }
    }
}

@Composable
private fun SmartPlaylistRow(
    smartPlaylist: SmartPlaylistInfo,
    serverUrl: String?,
    onOpen: () -> Unit,
    onPlay: () -> Unit,
    onShuffle: () -> Unit,
) {
    MediaRow(
        title = smartPlaylist.name,
        subtitle = listOfNotNull(
            "Smart playlist",
            smartPlaylist.songCount?.let { "$it songs" },
        ).joinToString(" • "),
        coverModel = serverUrl?.let {
            coverArtUrl(serverUrl = it, coverArtId = "sp-${smartPlaylist.id}", size = "small")
        },
        onClick = onOpen,
        trailing = {
            IconButton(onClick = onPlay) {
                Icon(Icons.Filled.PlayArrow, contentDescription = "Play")
            }
            IconButton(onClick = onShuffle) {
                Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle")
            }
        },
    )
}

@Composable
private fun PlaylistRow(
    playlist: PlaylistInFolder,
    serverUrl: String?,
    onOpen: () -> Unit,
    onPlay: () -> Unit,
    onShuffle: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }

    MediaRow(
        title = playlist.name,
        subtitle = listOfNotNull(
            "${playlist.songCount} songs",
            if (playlist.sharedWithMe) "Shared with me" else null,
        ).joinToString(" • "),
        coverModel = serverUrl
            ?.takeIf { playlist.songCount > 0 }
            ?.let { coverArtUrl(serverUrl = it, coverArtId = playlist.id, size = "small") },
        onClick = onOpen,
        trailing = {
            IconButton(onClick = onPlay) {
                Icon(Icons.Filled.PlayArrow, contentDescription = "Play")
            }
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
                            onShuffle()
                        },
                    )
                    if (playlist.canEdit) {
                        DropdownMenuItem(
                            text = { Text("Rename") },
                            onClick = {
                                menuExpanded = false
                                onRename()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Move to folder") },
                            onClick = {
                                menuExpanded = false
                                onMove()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Delete") },
                            onClick = {
                                menuExpanded = false
                                onDelete()
                            },
                        )
                    }
                }
            }
        },
    )
}

@Composable
private fun FolderHeader(
    folder: PlaylistFolderResponse,
    depth: Int,
    playlistCount: Int,
    onCreatePlaylist: () -> Unit,
    onCreateFolder: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (16 + depth * 16).dp, end = 8.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Filled.Folder,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = folder.name,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = "$playlistCount",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box {
            IconButton(onClick = { menuExpanded = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "Folder menu")
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { menuExpanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text("New playlist here") },
                    onClick = {
                        menuExpanded = false
                        onCreatePlaylist()
                    },
                )
                DropdownMenuItem(
                    text = { Text("New subfolder") },
                    onClick = {
                        menuExpanded = false
                        onCreateFolder()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Rename") },
                    onClick = {
                        menuExpanded = false
                        onRename()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Move") },
                    onClick = {
                        menuExpanded = false
                        onMove()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Delete") },
                    onClick = {
                        menuExpanded = false
                        onDelete()
                    },
                )
            }
        }
    }
}

private fun LazyListScope.folderNodes(
    nodes: List<PlaylistFolderNode>,
    serverUrl: String?,
    onOpenPlaylist: (String) -> Unit,
    onPlayPlaylist: (PlaylistInFolder) -> Unit,
    onShufflePlaylist: (PlaylistInFolder) -> Unit,
    onRenamePlaylist: (PlaylistInFolder) -> Unit,
    onMovePlaylist: (PlaylistInFolder) -> Unit,
    onDeletePlaylist: (PlaylistInFolder) -> Unit,
    onCreatePlaylist: (PlaylistFolderNode) -> Unit,
    onCreateFolder: (PlaylistFolderNode) -> Unit,
    onRenameFolder: (PlaylistFolderResponse) -> Unit,
    onMoveFolder: (PlaylistFolderResponse) -> Unit,
    onDeleteFolder: (PlaylistFolderResponse) -> Unit,
) {
    nodes.forEach { node ->
        item(key = "folder-${node.folder.id}") {
            FolderHeader(
                folder = node.folder,
                depth = node.depth,
                playlistCount = node.playlists.size,
                onCreatePlaylist = { onCreatePlaylist(node) },
                onCreateFolder = { onCreateFolder(node) },
                onRename = { onRenameFolder(node.folder) },
                onMove = { onMoveFolder(node.folder) },
                onDelete = { onDeleteFolder(node.folder) },
            )
        }
        items(node.playlists, key = { it.id }) { playlist ->
            PlaylistRow(
                playlist = playlist,
                serverUrl = serverUrl,
                onOpen = { onOpenPlaylist(playlist.id) },
                onPlay = { onPlayPlaylist(playlist) },
                onShuffle = { onShufflePlaylist(playlist) },
                onRename = { onRenamePlaylist(playlist) },
                onMove = { onMovePlaylist(playlist) },
                onDelete = { onDeletePlaylist(playlist) },
            )
        }
        folderNodes(
            nodes = node.children,
            serverUrl = serverUrl,
            onOpenPlaylist = onOpenPlaylist,
            onPlayPlaylist = onPlayPlaylist,
            onShufflePlaylist = onShufflePlaylist,
            onRenamePlaylist = onRenamePlaylist,
            onMovePlaylist = onMovePlaylist,
            onDeletePlaylist = onDeletePlaylist,
            onCreatePlaylist = onCreatePlaylist,
            onCreateFolder = onCreateFolder,
            onRenameFolder = onRenameFolder,
            onMoveFolder = onMoveFolder,
            onDeleteFolder = onDeleteFolder,
        )
    }
}

private fun subtreeIds(nodes: List<PlaylistFolderNode>, rootId: String): Set<String> {
    val result = mutableSetOf<String>()
    fun visit(node: PlaylistFolderNode) {
        result += node.folder.id
        node.children.forEach(::visit)
    }
    fun find(node: PlaylistFolderNode): Boolean {
        if (node.folder.id == rootId) {
            visit(node)
            return true
        }
        return node.children.any(::find)
    }
    nodes.forEach(::find)
    return result
}
