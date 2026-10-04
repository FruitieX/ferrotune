package com.ferrotune.feature.playlists.ui

import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.layout.Box
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.MediaGridMinCellWidth
import com.ferrotune.core.designsystem.components.bleedHorizontal
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.feature.playlists.data.PlaylistFolderNode
import com.ferrotune.feature.playlists.data.folderPath

/** Web `text-amber-500` folder glyph. */
private val FolderAmber = Color(0xFFF59E0B)

/** Web `text-emerald-500` playlist glyph. */
internal val PlaylistEmerald = Color(0xFF10B981)

/** Web `text-purple-500` smart playlist glyph. */
internal val SmartPurple = Color(0xFFA855F7)

/** Web playlists header tile: `from-emerald-500 to-emerald-800`. */
private val EmeraldGradient = listOf(Color(0xFF10B981), Color(0xFF065F46))

/** Web folder placeholder: `from-amber-500/20 to-amber-700/20`. */
private val FolderPlaceholder = listOf(Color(0x33F59E0B), Color(0x33B45309))

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

/**
 * The web Playlists page: a "Collection" header, breadcrumb inside folders,
 * play/shuffle/filter/⋯ action bar, and a three-column grid of folders,
 * playlists, and smart playlists. System back walks up the folder path.
 */
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
    var pageMenuOpen by remember { mutableStateOf(false) }
    var folderMenu by remember { mutableStateOf<PlaylistFolderNode?>(null) }
    val collectionMenu = rememberCollectionMenuState()
    val items = state.browserItems()
    val path = state.tree.folderPath(state.currentFolderId)
    val currentFolder = path.lastOrNull()

    BackHandler(enabled = state.currentFolderId != null) { viewModel.navigateUp() }

    val actionBar: @Composable () -> Unit = {
        DetailActionBar(
            onPlayAll = { viewModel.playAll(shuffle = false) },
            onShuffle = { viewModel.playAll(shuffle = true) },
            playEnabled = items.any { it !is PlaylistBrowserItem.Folder },
            actions = {
                FilterPill(
                    value = state.filter,
                    onValueChange = viewModel::setFilter,
                    placeholder = "Filter playlists...",
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { pageMenuOpen = true }) {
                    Icon(Icons.Filled.MoreHoriz, contentDescription = "More options")
                }
            },
        )
    }
    val gridState = rememberLazyGridState()
    val actionBarPinned by rememberActionBarPinned(gridState)

    Box(modifier = modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(MediaGridMinCellWidth),
            state = gridState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "header", span = { GridItemSpan(maxLineSpan) }) {
                DetailHero(
                    backdropColor = Color(0x3310B981),
                    modifier = Modifier.bleedHorizontal(12.dp),
                ) {
                    DetailHeader(
                        title = currentFolder?.name ?: "Playlists",
                        label = if (currentFolder != null) "Folder" else "Collection",
                        meta = if (state.loading && items.isEmpty()) {
                            null
                        } else {
                            playlistsSummary(state, items)
                        },
                        icon = if (currentFolder != null) Icons.Filled.FolderOpen else Icons.AutoMirrored.Filled.QueueMusic,
                        iconGradient = EmeraldGradient,
                        showBackButton = currentFolder != null,
                        onBack = { viewModel.navigateUp() },
                    )
                    if (currentFolder != null) {
                        Breadcrumb(
                            path = path,
                            onOpenFolder = viewModel::openFolder,
                        )
                    }
                }
            }

            item(key = ACTION_BAR_ITEM_KEY, span = { GridItemSpan(maxLineSpan) }) {
                Box(modifier = Modifier.bleedHorizontal(12.dp).padding(bottom = 4.dp)) { actionBar() }
            }

            when {
                state.loading && items.isEmpty() -> items(9, key = { "skeleton-$it" }) { MediaCardSkeleton() }

                state.error != null && items.isEmpty() -> item(key = "error", span = { GridItemSpan(maxLineSpan) }) {
                    ErrorState(message = state.error!!, onRetry = viewModel::load)
                }

                items.isEmpty() -> item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                    if (state.filter.isNotBlank()) {
                        EmptyState(message = "No playlists match your filter")
                    } else {
                        EmptyState(
                            message = if (currentFolder == null) "No playlists yet" else "This folder is empty",
                            icon = Icons.AutoMirrored.Filled.QueueMusic,
                            description = "Create your first playlist to organize your favorite music.",
                            action = {
                                Button(onClick = { dialog = PlaylistsDialog.CreatePlaylist(state.currentFolderId) }) {
                                    Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Text("Create playlist", modifier = Modifier.padding(start = 8.dp))
                                }
                            },
                        )
                    }
                }

                else -> items(items, key = { it.key }) { item ->
                    when (item) {
                        is PlaylistBrowserItem.Folder -> FolderCard(
                            item = item,
                            serverUrl = state.serverUrl,
                            onOpen = { viewModel.openFolder(item.node.folder.id) },
                            onLongClick = { folderMenu = item.node },
                        )

                        is PlaylistBrowserItem.Playlist -> PlaylistCard(
                            playlist = item.playlist,
                            serverUrl = state.serverUrl,
                            onOpen = { onOpenPlaylist(item.playlist.id) },
                            onLongClick = {
                                collectionMenu.open(item.playlist.toTarget(state.serverUrl))
                            },
                        )

                        is PlaylistBrowserItem.Smart -> MediaCard(
                            title = item.smartPlaylist.name,
                            subtitle = item.smartPlaylist.songCount?.let { formatCount(it.toInt(), "song") }
                                ?: "Smart playlist",
                            coverModel = smartCover(state.serverUrl, item.smartPlaylist.id),
                            seed = "smart-${item.smartPlaylist.id}",
                            titleIcon = Icons.Filled.AutoAwesome,
                            titleIconTint = SmartPurple,
                            onClick = { onOpenSmartPlaylist(item.smartPlaylist.id) },
                            onLongClick = {
                                collectionMenu.open(
                                    CollectionTarget(
                                        sourceType = CollectionSource.SMART_PLAYLIST,
                                        sourceId = item.smartPlaylist.id,
                                        name = item.smartPlaylist.name,
                                        subtitle = "Smart playlist",
                                        coverModel = smartCover(state.serverUrl, item.smartPlaylist.id),
                                    ),
                                )
                            },
                        )
                    }
                }
            }
        }
        PinnedActionBar(visible = actionBarPinned) { actionBar() }
    }

    CollectionMenuSheet(
        state = collectionMenu,
        extraActions = { target ->
            val playlist = state.tree.findPlaylist(target.sourceId)
            if (target.sourceType == CollectionSource.SMART_PLAYLIST) {
                listOf(
                    MediaAction("Edit rules", Icons.Filled.Edit, separatorBefore = true) {
                        onOpenSmartPlaylist(target.sourceId)
                    },
                )
            } else if (playlist?.canEdit == true) {
                listOf(
                    MediaAction("Rename", Icons.Filled.Edit, separatorBefore = true) {
                        dialog = PlaylistsDialog.RenamePlaylist(playlist)
                    },
                    MediaAction("Move to folder", Icons.AutoMirrored.Filled.DriveFileMove) {
                        dialog = PlaylistsDialog.MovePlaylist(playlist)
                    },
                    MediaAction("Delete", Icons.Filled.Delete, destructive = true) {
                        dialog = PlaylistsDialog.DeletePlaylist(playlist)
                    },
                )
            } else {
                emptyList()
            }
        },
    )

    folderMenu?.let { node ->
        MediaActionSheet(
            expanded = true,
            onDismiss = { folderMenu = null },
            title = node.folder.name,
            subtitle = "Folder",
            placeholder = Icons.Filled.Folder,
            actions = listOf(
                MediaAction("Open", Icons.Filled.FolderOpen) { viewModel.openFolder(node.folder.id) },
                MediaAction("New playlist here", Icons.Filled.Add) {
                    dialog = PlaylistsDialog.CreatePlaylist(node.folder.id)
                },
                MediaAction("New subfolder", Icons.Filled.CreateNewFolder) {
                    dialog = PlaylistsDialog.CreateFolder(node.folder.id)
                },
                MediaAction("Rename", Icons.Filled.Edit, separatorBefore = true) {
                    dialog = PlaylistsDialog.RenameFolder(node.folder)
                },
                MediaAction("Move", Icons.AutoMirrored.Filled.DriveFileMove) {
                    dialog = PlaylistsDialog.MoveFolder(node.folder)
                },
                MediaAction("Delete", Icons.Filled.Delete, destructive = true) {
                    dialog = PlaylistsDialog.DeleteFolder(node.folder)
                },
            ),
        )
    }

    if (pageMenuOpen) {
        MediaActionSheet(
            expanded = true,
            onDismiss = { pageMenuOpen = false },
            actions = buildList {
                add(
                    MediaAction("New playlist", Icons.Filled.Add) {
                        dialog = PlaylistsDialog.CreatePlaylist(state.currentFolderId)
                    },
                )
                add(MediaAction("New smart playlist", Icons.Filled.AutoAwesome, onClick = onCreateSmartPlaylist))
                add(
                    MediaAction("New folder", Icons.Filled.CreateNewFolder) {
                        dialog = PlaylistsDialog.CreateFolder(state.currentFolderId)
                    },
                )
                if (currentFolder != null) {
                    add(
                        MediaAction("Rename folder", Icons.Filled.Edit, separatorBefore = true) {
                            dialog = PlaylistsDialog.RenameFolder(currentFolder)
                        },
                    )
                }
            },
            extraContent = {
                SortSheetSection(
                    options = PlaylistsSort.entries.map { SortOption(it.name, it.label) },
                    selectedKey = state.sort.name,
                    ascending = state.ascending,
                    onSelect = { viewModel.selectSort(PlaylistsSort.valueOf(it)) },
                    onToggleDirection = viewModel::toggleSortDirection,
                )
            },
        )
    }

    PlaylistsDialogs(
        dialog = dialog,
        state = state,
        viewModel = viewModel,
        onDismiss = { dialog = null },
    )
}

@Composable
private fun PlaylistsDialogs(
    dialog: PlaylistsDialog?,
    state: PlaylistsUiState,
    viewModel: PlaylistsViewModel,
    onDismiss: () -> Unit,
) {
    when (dialog) {
        is PlaylistsDialog.CreatePlaylist -> NameDialog(
            title = "New playlist",
            confirmLabel = "Create",
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.createPlaylist(it, dialog.folderId)
                onDismiss()
            },
        )

        is PlaylistsDialog.CreateFolder -> NameDialog(
            title = "New folder",
            confirmLabel = "Create",
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.createFolder(it, dialog.parentId)
                onDismiss()
            },
        )

        is PlaylistsDialog.RenamePlaylist -> NameDialog(
            title = "Rename playlist",
            initialValue = dialog.playlist.name,
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.renamePlaylist(dialog.playlist.id, it)
                onDismiss()
            },
        )

        is PlaylistsDialog.RenameFolder -> NameDialog(
            title = "Rename folder",
            initialValue = dialog.folder.name,
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.renameFolder(dialog.folder.id, it)
                onDismiss()
            },
        )

        is PlaylistsDialog.MovePlaylist -> FolderPickerDialog(
            title = "Move ${dialog.playlist.name}",
            nodes = state.tree.folders,
            onDismiss = onDismiss,
            onSelect = { folderId ->
                viewModel.movePlaylist(dialog.playlist.id, folderId)
                onDismiss()
            },
        )

        is PlaylistsDialog.MoveFolder -> FolderPickerDialog(
            title = "Move ${dialog.folder.name}",
            nodes = state.tree.folders,
            excludeIds = subtreeIds(state.tree.folders, dialog.folder.id),
            onDismiss = onDismiss,
            onSelect = { parentId ->
                viewModel.moveFolder(dialog.folder.id, parentId)
                onDismiss()
            },
        )

        is PlaylistsDialog.DeletePlaylist -> ConfirmDialog(
            title = "Delete playlist",
            message = "Delete \"${dialog.playlist.name}\"?",
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.deletePlaylist(dialog.playlist.id)
                onDismiss()
            },
        )

        is PlaylistsDialog.DeleteFolder -> ConfirmDialog(
            title = "Delete folder",
            message = "Delete \"${dialog.folder.name}\"? Playlists inside move to the root.",
            onDismiss = onDismiss,
            onConfirm = {
                viewModel.deleteFolder(dialog.folder.id)
                onDismiss()
            },
        )

        null -> Unit
    }
}

/** Web subtitle: "N folders • N playlists • total duration". */
private fun playlistsSummary(state: PlaylistsUiState, items: List<PlaylistBrowserItem>): String {
    val folders = items.count { it is PlaylistBrowserItem.Folder }
    val playlists = items.count { it !is PlaylistBrowserItem.Folder }
    val duration = items.sumOf { (it as? PlaylistBrowserItem.Playlist)?.playlist?.duration ?: 0L }
    return "${formatCount(folders, "folder")} • ${formatCount(playlists, "playlist")} • " +
        formatTotalDuration(duration)
}

/** Web breadcrumb: home icon, then each folder; the current folder is bold. */
@Composable
private fun Breadcrumb(
    path: List<PlaylistFolderResponse>,
    onOpenFolder: (String?) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Filled.Home,
            contentDescription = "All playlists",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .size(28.dp)
                .clickable { onOpenFolder(null) }
                .padding(5.dp),
        )
        path.forEachIndexed { index, folder ->
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            val current = index == path.lastIndex
            Text(
                text = folder.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (current) FontWeight.Medium else FontWeight.Normal,
                color = if (current) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                modifier = Modifier
                    .clickable(enabled = !current) { onOpenFolder(folder.id) }
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
}

@Composable
private fun FolderCard(
    item: PlaylistBrowserItem.Folder,
    serverUrl: String?,
    onOpen: () -> Unit,
    onLongClick: () -> Unit,
) {
    val folder = item.node.folder
    val subtitle = buildList {
        if (item.node.children.isNotEmpty()) add(formatCount(item.node.children.size, "folder"))
        add(if (item.playlistCount > 0) formatCount(item.playlistCount, "playlist") else "Empty")
    }.joinToString(" • ")
    MediaCard(
        title = folder.name,
        subtitle = subtitle,
        coverModel = serverUrl
            ?.takeIf { folder.hasCoverArt }
            ?.let { coverArtUrl(serverUrl = it, coverArtId = "pf-${folder.id}", size = "medium") },
        seed = folder.name,
        titleIcon = Icons.Filled.Folder,
        titleIconTint = FolderAmber,
        placeholderColors = FolderPlaceholder,
        placeholderTint = FolderAmber,
        onClick = onOpen,
        onLongClick = onLongClick,
    )
}

@Composable
private fun PlaylistCard(
    playlist: PlaylistInFolder,
    serverUrl: String?,
    onOpen: () -> Unit,
    onLongClick: () -> Unit,
) {
    MediaCard(
        title = playlist.name,
        subtitle = "${formatCount(playlist.songCount.toInt(), "song")} • ${formatClockDuration(playlist.duration * 1000)}",
        coverModel = playlistCover(serverUrl, playlist),
        seed = playlist.name,
        titleIcon = Icons.AutoMirrored.Filled.QueueMusic,
        titleIconTint = PlaylistEmerald,
        onClick = onOpen,
        onLongClick = onLongClick,
    )
}

private fun playlistCover(serverUrl: String?, playlist: PlaylistInFolder): String? =
    serverUrl
        ?.takeIf { playlist.songCount > 0 }
        ?.let { coverArtUrl(serverUrl = it, coverArtId = playlist.id, size = "medium") }

private fun smartCover(serverUrl: String?, smartPlaylistId: String): String? =
    serverUrl?.let { coverArtUrl(serverUrl = it, coverArtId = "sp-$smartPlaylistId", size = "medium") }

private fun PlaylistInFolder.toTarget(serverUrl: String?) = CollectionTarget(
    sourceType = CollectionSource.PLAYLIST,
    sourceId = id,
    name = name,
    subtitle = formatCount(songCount.toInt(), "song"),
    coverModel = playlistCover(serverUrl, this),
)

private fun com.ferrotune.feature.playlists.data.PlaylistTree.findPlaylist(id: String): PlaylistInFolder? {
    rootPlaylists.firstOrNull { it.id == id }?.let { return it }
    fun find(nodes: List<PlaylistFolderNode>): PlaylistInFolder? {
        for (node in nodes) {
            node.playlists.firstOrNull { it.id == id }?.let { return it }
            find(node.children)?.let { return it }
        }
        return null
    }
    return find(folders)
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
