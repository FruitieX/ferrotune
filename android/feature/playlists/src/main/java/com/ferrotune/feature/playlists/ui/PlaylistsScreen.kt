package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.ferrotune.core.actions.CollectionActionSheet
import com.ferrotune.core.actions.CollectionActionsViewModel
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PageTitle
import com.ferrotune.core.designsystem.components.SectionHeader
import com.ferrotune.core.designsystem.components.ShelfCard
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.RecentPlaylistEntry
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.feature.playlists.data.PlaylistFolderNode
import com.ferrotune.feature.playlists.data.folderPath
import com.ferrotune.feature.playlists.data.foldersIn
import com.ferrotune.feature.playlists.data.playlistsIn

/** Web `text-amber-500` folder glyph. */
private val FOLDER_ACCENT = Color(0xFFF59E0B)

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
    onCreateSmartPlaylist: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlaylistsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<PlaylistsDialog?>(null) }
    var addMenuExpanded by remember { mutableStateOf(false) }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = modifier,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            PlaylistsTopBar(
                state = state,
                addMenuExpanded = addMenuExpanded,
                onAddMenuExpandedChange = { addMenuExpanded = it },
                onNavigateUp = viewModel::navigateUp,
                onOpenFolder = viewModel::openFolder,
                onNewPlaylist = {
                    dialog = PlaylistsDialog.CreatePlaylist(state.currentFolderId)
                },
                onNewFolder = {
                    dialog = PlaylistsDialog.CreateFolder(state.currentFolderId)
                },
                onCreateSmartPlaylist = onCreateSmartPlaylist,
            )
            PlaylistsContent(
                state = state,
                onRetry = viewModel::load,
                onOpenPlaylist = onOpenPlaylist,
                onOpenSmartPlaylist = onOpenSmartPlaylist,
                onOpenFolder = viewModel::openFolder,
                onPlayPlaylist = { viewModel.playPlaylist(it, shuffle = false) },
                onShufflePlaylist = { viewModel.playPlaylist(it, shuffle = true) },
                onPlaySmartPlaylist = { viewModel.playSmartPlaylist(it, shuffle = false) },
                onShuffleSmartPlaylist = { viewModel.playSmartPlaylist(it, shuffle = true) },
                onDialog = { dialog = it },
            )
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
private fun PlaylistsTopBar(
    state: PlaylistsUiState,
    addMenuExpanded: Boolean,
    onAddMenuExpandedChange: (Boolean) -> Unit,
    onNavigateUp: () -> Unit,
    onOpenFolder: (String?) -> Unit,
    onNewPlaylist: () -> Unit,
    onNewFolder: () -> Unit,
    onCreateSmartPlaylist: () -> Unit,
) {
    val path = state.tree.folderPath(state.currentFolderId)
    val currentFolder = path.lastOrNull()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.currentFolderId != null) {
                IconButton(onClick = onNavigateUp, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Up one folder",
                    )
                }
                Spacer(Modifier.width(4.dp))
            }
            PageTitle(
                text = currentFolder?.name ?: "Playlists",
                modifier = Modifier.weight(1f),
            )
            Box {
                OutlinedButton(onClick = { onAddMenuExpandedChange(true) }) {
                    Icon(
                        imageVector = Icons.Filled.Add,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                    )
                    Text("New", modifier = Modifier.padding(start = 8.dp))
                }
                DropdownMenu(
                    expanded = addMenuExpanded,
                    onDismissRequest = { onAddMenuExpandedChange(false) },
                ) {
                    DropdownMenuItem(
                        text = { Text("New playlist") },
                        onClick = {
                            onAddMenuExpandedChange(false)
                            onNewPlaylist()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("New folder") },
                        onClick = {
                            onAddMenuExpandedChange(false)
                            onNewFolder()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("New smart playlist") },
                        onClick = {
                            onAddMenuExpandedChange(false)
                            onCreateSmartPlaylist()
                        },
                    )
                }
            }
        }
        if (state.currentFolderId != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp)
                    .padding(bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BreadcrumbCrumb(
                    text = "Playlists",
                    active = false,
                    onClick = { onOpenFolder(null) },
                )
                path.forEachIndexed { index, folder ->
                    Icon(
                        imageVector = Icons.Filled.ChevronRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                    BreadcrumbCrumb(
                        text = folder.name,
                        active = index == path.lastIndex,
                        onClick = { onOpenFolder(folder.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun BreadcrumbCrumb(
    text: String,
    active: Boolean,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelLarge,
        color = if (active) {
            MaterialTheme.colorScheme.onSurface
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        maxLines = 1,
        modifier = Modifier
            .clickable(enabled = !active, onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 2.dp),
    )
}

@Composable
private fun PlaylistsContent(
    state: PlaylistsUiState,
    onRetry: () -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onPlayPlaylist: (PlaylistInFolder) -> Unit,
    onShufflePlaylist: (PlaylistInFolder) -> Unit,
    onPlaySmartPlaylist: (SmartPlaylistInfo) -> Unit,
    onShuffleSmartPlaylist: (SmartPlaylistInfo) -> Unit,
    onDialog: (PlaylistsDialog) -> Unit,
) {
    val currentFolderId = state.currentFolderId
    val folders = state.tree.foldersIn(currentFolderId)
    val playlists = state.tree.playlistsIn(currentFolderId)
    val smartPlaylists = state.smartPlaylists.filter { it.folderId == currentFolderId }
    val isRoot = currentFolderId == null

    when {
        state.loading && state.tree.folders.isEmpty() && state.tree.rootPlaylists.isEmpty() ->
            MediaRowSkeletonList(
                count = 10,
                modifier = Modifier.fillMaxSize(),
            )

        state.error != null -> Box(modifier = Modifier.fillMaxSize()) {
            ErrorState(message = state.error!!, onRetry = onRetry)
        }

        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 96.dp),
        ) {
            if (isRoot && state.recentlyPlayed.isNotEmpty()) {
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
            if (smartPlaylists.isNotEmpty()) {
                item {
                    SectionHeader("Smart playlists")
                }
                items(smartPlaylists, key = { "smart-${it.id}" }) { smart ->
                    SmartPlaylistRow(
                        smartPlaylist = smart,
                        serverUrl = state.serverUrl,
                        onOpen = { onOpenSmartPlaylist(smart.id) },
                        onPlay = { onPlaySmartPlaylist(smart) },
                        onShuffle = { onShuffleSmartPlaylist(smart) },
                    )
                }
            }
            if (playlists.isNotEmpty() || folders.isNotEmpty()) {
                item {
                    SectionHeader(if (isRoot) "Your library" else "Playlists")
                }
            }
            items(playlists, key = { it.id }) { playlist ->
                PlaylistRow(
                    playlist = playlist,
                    serverUrl = state.serverUrl,
                    onOpen = { onOpenPlaylist(playlist.id) },
                    onPlay = { onPlayPlaylist(playlist) },
                    onShuffle = { onShufflePlaylist(playlist) },
                    onRename = { onDialog(PlaylistsDialog.RenamePlaylist(playlist)) },
                    onMove = { onDialog(PlaylistsDialog.MovePlaylist(playlist)) },
                    onDelete = { onDialog(PlaylistsDialog.DeletePlaylist(playlist)) },
                )
            }
            items(folders, key = { "folder-${it.folder.id}" }) { node ->
                FolderRow(
                    node = node,
                    smartPlaylistCount = state.smartPlaylists.count {
                        it.folderId == node.folder.id
                    },
                    onOpen = { onOpenFolder(node.folder.id) },
                    onCreatePlaylist = {
                        onDialog(PlaylistsDialog.CreatePlaylist(node.folder.id))
                    },
                    onCreateFolder = {
                        onDialog(PlaylistsDialog.CreateFolder(node.folder.id))
                    },
                    onRename = { onDialog(PlaylistsDialog.RenameFolder(node.folder)) },
                    onMove = { onDialog(PlaylistsDialog.MoveFolder(node.folder)) },
                    onDelete = { onDialog(PlaylistsDialog.DeleteFolder(node.folder)) },
                )
            }
            if (folders.isEmpty() && playlists.isEmpty() && smartPlaylists.isEmpty()) {
                item {
                    EmptyState(if (isRoot) "No playlists yet" else "This folder is empty")
                }
            }
        }
    }
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
            var menuExpanded by remember { mutableStateOf(false) }
            Box {
                ShelfCard(
                    title = entry.name,
                    subtitle = if (isSmart) "Smart playlist" else "Playlist",
                    seed = entry.id,
                    coverModel = serverUrl?.let {
                        coverArtUrl(
                            serverUrl = it,
                            coverArtId = if (isSmart) "sp-${entry.id}" else entry.id,
                            size = "small",
                        )
                    },
                    onClick = {
                        if (isSmart) onOpenSmartPlaylist(entry.id) else onOpenPlaylist(entry.id)
                    },
                    onLongClick = { menuExpanded = true },
                )
                CollectionActionSheet(
                    expanded = menuExpanded,
                    onDismiss = { menuExpanded = false },
                    target = CollectionTarget(
                        sourceType = if (isSmart) {
                            CollectionSource.SMART_PLAYLIST
                        } else {
                            CollectionSource.PLAYLIST
                        },
                        sourceId = entry.id,
                        name = entry.name,
                    ),
                    title = entry.name,
                    subtitle = if (isSmart) "Smart playlist" else "Playlist",
                    coverModel = serverUrl?.let {
                        coverArtUrl(
                            serverUrl = it,
                            coverArtId = if (isSmart) "sp-${entry.id}" else entry.id,
                            size = "small",
                        )
                    },
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
    var menuExpanded by remember { mutableStateOf(false) }
    val collectionActions: CollectionActionsViewModel = hiltViewModel()
    val target = CollectionTarget(
        sourceType = CollectionSource.SMART_PLAYLIST,
        sourceId = smartPlaylist.id,
        name = smartPlaylist.name,
    )
    Box {
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
            onLongClick = { menuExpanded = true },
            trailing = {
                IconButton(onClick = onPlay) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = "Play")
                }
                IconButton(onClick = onShuffle) {
                    Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle")
                }
            },
        )
        DropdownMenu(
            expanded = menuExpanded,
            onDismissRequest = { menuExpanded = false },
        ) {
            DropdownMenuItem(
                text = { Text("Play next") },
                onClick = {
                    menuExpanded = false
                    collectionActions.playNext(target)
                },
            )
            DropdownMenuItem(
                text = { Text("Add to queue") },
                onClick = {
                    menuExpanded = false
                    collectionActions.addToQueue(target)
                },
            )
        }
    }
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
    val collectionActions: CollectionActionsViewModel = hiltViewModel()
    val target = CollectionTarget(
        sourceType = CollectionSource.PLAYLIST,
        sourceId = playlist.id,
        name = playlist.name,
    )

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
        onLongClick = { menuExpanded = true },
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
                        text = { Text("Play next") },
                        onClick = {
                            menuExpanded = false
                            collectionActions.playNext(target)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Add to queue") },
                        onClick = {
                            menuExpanded = false
                            collectionActions.addToQueue(target)
                        },
                    )
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

/**
 * Folder browser row: tapping drills into the folder; the trailing menu keeps
 * the create/rename/move/delete actions that used to live on the expanded
 * folder header.
 */
@Composable
private fun FolderRow(
    node: PlaylistFolderNode,
    smartPlaylistCount: Int,
    onOpen: () -> Unit,
    onCreatePlaylist: () -> Unit,
    onCreateFolder: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    val playlistCount = node.playlists.size + smartPlaylistCount
    val subtitle = buildList {
        if (node.children.isNotEmpty()) add(formatCount(node.children.size, "folder"))
        add(if (playlistCount > 0) formatCount(playlistCount, "playlist") else "Empty")
    }.joinToString(" • ")

    MediaRow(
        title = node.folder.name,
        subtitle = subtitle,
        coverModel = null,
        coverSeed = node.folder.name,
        coverPlaceholder = Icons.Filled.Folder,
        coverPlaceholderTint = FOLDER_ACCENT,
        onClick = onOpen,
        onLongClick = { menuExpanded = true },
        trailing = {
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
        },
    )
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
