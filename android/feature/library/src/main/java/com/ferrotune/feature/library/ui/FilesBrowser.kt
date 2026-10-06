package com.ferrotune.feature.library.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.CoverSize
import com.ferrotune.core.actions.SongMenuState
import com.ferrotune.core.actions.SongMenuTarget
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.formatFileSize
import com.ferrotune.core.actions.rememberDisabledSongIds
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.TrackRow
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.network.generated.DirectoryChildPaged
import com.ferrotune.core.network.readableMessage

/**
 * The web Library → Files page as a Library tab: the library list, then a
 * folder heading with play/shuffle, breadcrumbs, and the folder's subfolders
 * followed by its files. System back walks up the folder path.
 */
@Composable
internal fun FilesBrowser(
    filter: String,
    songMenu: SongMenuState,
    listState: LazyListState,
    viewModel: FilesViewModel,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var folderMenu by remember { mutableStateOf<DirectoryChildPaged?>(null) }

    LaunchedEffect(Unit) { viewModel.activate() }
    LaunchedEffect(filter) { viewModel.setFilter(filter) }
    BackHandler(enabled = state.location != null) { viewModel.navigateUp() }
    // Each folder opens at the top.
    LaunchedEffect(state.location) { listState.scrollToItem(0) }

    if (state.location == null) {
        LibraryList(state = state, listState = listState, viewModel = viewModel)
    } else {
        DirectoryList(
            state = state,
            listState = listState,
            songMenu = songMenu,
            viewModel = viewModel,
            onFolderMenu = { folderMenu = it },
        )
    }

    folderMenu?.let { folder ->
        MediaActionSheet(
            expanded = true,
            onDismiss = { folderMenu = null },
            title = folder.title,
            subtitle = folderSubtitle(folder),
            placeholder = Icons.Filled.Folder,
            seed = folder.title,
            actions = listOf(
                MediaAction("Play", Icons.Filled.PlayArrow) { viewModel.playFolder(folder) },
                MediaAction("Shuffle", Icons.Filled.Shuffle) { viewModel.playFolder(folder, shuffle = true) },
                MediaAction("Play next", Icons.AutoMirrored.Filled.PlaylistPlay, separatorBefore = true) {
                    viewModel.addFolderToQueue(folder, QueueAddPosition.NEXT)
                },
                MediaAction("Add to queue", Icons.AutoMirrored.Filled.PlaylistAdd) {
                    viewModel.addFolderToQueue(folder, QueueAddPosition.END)
                },
                MediaAction("Open", Icons.Filled.FolderOpen, separatorBefore = true) {
                    viewModel.openFolder(folder.path ?: folder.id)
                },
            ),
        )
    }
}

@Composable
private fun LibraryList(state: FilesUiState, listState: LazyListState, viewModel: FilesViewModel) {
    val libraries = state.visibleLibraries
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item(key = "header") {
            val songs = state.libraries.sumOf { it.songCount }
            val size = state.libraries.sumOf { it.totalSize }
            FilesHeading(
                icon = Icons.Filled.LibraryMusic,
                title = "Browse Files",
                subtitle = if (state.librariesLoading && state.libraries.isEmpty()) {
                    "Loading libraries…"
                } else {
                    "${formatCount(state.libraries.size, "library", "libraries")}, " +
                        "${formatCount(songs.toInt(), "song")} • ${formatFileSize(size)}"
                },
            )
        }
        when {
            state.librariesError != null && state.libraries.isEmpty() -> item(key = "error") {
                ErrorState(message = state.librariesError, onRetry = viewModel::loadLibraries)
            }

            state.librariesLoading && state.libraries.isEmpty() -> item(key = "loading") { MediaRowSkeletonList(count = 3) }

            libraries.isEmpty() -> item(key = "empty") {
                EmptyState(
                    if (state.filter.isBlank()) "No music libraries available" else "No libraries match your filter",
                    icon = Icons.Filled.LibraryMusic,
                )
            }

            else -> items(libraries, key = { "library-${it.id}" }) { library ->
                MediaRow(
                    title = library.name,
                    subtitle = "${formatCount(library.songCount.toInt(), "song")} • ${formatFileSize(library.totalSize)}",
                    coverModel = null,
                    coverSeed = library.name,
                    coverPlaceholder = Icons.Filled.LibraryMusic,
                    onClick = { viewModel.openLibrary(library.id) },
                )
            }
        }
    }
}

@Composable
private fun DirectoryList(
    state: FilesUiState,
    listState: LazyListState,
    songMenu: SongMenuState,
    viewModel: FilesViewModel,
    onFolderMenu: (DirectoryChildPaged) -> Unit,
) {
    val children = viewModel.children.collectAsLazyPagingItems()
    val nowPlaying = rememberNowPlaying()
    val disabledSongs = rememberDisabledSongIds()
    val summary = state.currentSummary
    val libraryName = summary?.libraryName ?: state.libraries.firstOrNull { it.id == state.location?.libraryId }?.name
    val refresh = children.loadState.refresh

    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item(key = "header") {
            FilesHeading(
                icon = Icons.Filled.Folder,
                title = summary?.name ?: libraryName ?: "Files",
                subtitle = summary?.let {
                    // The size covers this folder's own files, so skip it for folders of folders.
                    listOfNotNull(
                        "${formatCount(it.folderCount.toInt(), "folder")}, ${formatCount(it.fileCount.toInt(), "file")}",
                        it.totalSize.takeIf { size -> size > 0 }?.let(::formatFileSize),
                    ).joinToString(" • ")
                } ?: "Loading…",
                actions = {
                    if ((summary?.fileCount ?: 0) > 0 || (summary?.folderCount ?: 0) > 0) {
                        IconButton(onClick = { viewModel.playCurrentFolder(shuffle = true) }) {
                            Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle folder")
                        }
                        FilledIconButton(onClick = { viewModel.playCurrentFolder(shuffle = false) }) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = "Play folder")
                        }
                    }
                },
            )
        }
        item(key = "breadcrumbs") {
            Breadcrumbs(
                libraryName = libraryName ?: "Library",
                summary = summary,
                atLibraryRoot = state.location?.path.isNullOrEmpty(),
                onFiles = viewModel::showLibraries,
                onOpen = viewModel::openFolder,
            )
        }
        when {
            refresh is LoadState.Error && children.itemCount == 0 -> item(key = "error") {
                ErrorState(message = refresh.error.readableMessage() ?: "Failed to load folder", onRetry = children::retry)
            }

            refresh is LoadState.Loading && children.itemCount == 0 -> item(key = "loading") { MediaRowSkeletonList(count = 10) }

            children.itemCount == 0 -> item(key = "empty") {
                EmptyState(
                    if (state.filter.isBlank()) "This folder is empty" else "No matching items",
                    icon = Icons.Filled.Folder,
                )
            }

            else -> {
                items(
                    count = children.itemCount,
                    key = children.itemKey { (if (it.isDir) "dir:" else "file:") + it.id },
                    contentType = { index -> if (children.peek(index)?.isDir == true) "dir" else "file" },
                ) { index ->
                    val child = children[index] ?: return@items
                    if (child.isDir) {
                        MediaRow(
                            title = child.title,
                            subtitle = folderSubtitle(child),
                            coverModel = null,
                            coverSeed = child.title,
                            coverPlaceholder = Icons.Filled.Folder,
                            onClick = { viewModel.openFolder(child.path ?: child.id) },
                            onLongClick = { onFolderMenu(child) },
                        )
                    } else {
                        val current = nowPlaying.songId == child.id
                        val disabled = child.id in disabledSongs
                        TrackRow(
                            title = child.title,
                            subtitle = listOfNotNull(
                                child.artist?.takeIf { it.isNotBlank() },
                                child.album?.takeIf { it.isNotBlank() },
                            ).joinToString(" • ").ifEmpty { child.suffix?.uppercase() },
                            coverModel = coverModel(child.coverArtData, child.coverArt, CoverSize.SMALL),
                            coverSeed = child.album ?: child.title,
                            onClick = { viewModel.playFile(child, index) },
                            onLongClick = { songMenu.open(child.toMenuTarget()) },
                            isCurrent = current,
                            isPlaying = current && nowPlaying.isPlaying,
                            duration = child.duration?.let { formatClockDuration(it * 1000) },
                            dimmed = disabled,
                            trailing = if (disabled) {
                                {
                                    Icon(
                                        Icons.Filled.Block,
                                        contentDescription = "Disabled: skipped in automatic playback",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(14.dp),
                                    )
                                }
                            } else {
                                null
                            },
                        )
                    }
                }
                item(key = "footer") { PagingListFooter(isLoading = children.loadState.append is LoadState.Loading) }
            }
        }
    }
}

/** Web Files heading: icon tile, title, counts, and optional actions. */
@Composable
private fun FilesHeading(
    icon: ImageVector,
    title: String,
    subtitle: String,
    actions: @Composable () -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 12.dp, top = 16.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        actions()
    }
}

/** Web breadcrumbs: Files › library › ancestors › current folder. */
@Composable
private fun Breadcrumbs(
    libraryName: String,
    summary: DirectorySummary?,
    atLibraryRoot: Boolean,
    onFiles: () -> Unit,
    onOpen: (String) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Crumb(onClick = onFiles) {
            Icon(Icons.Filled.Home, contentDescription = null, modifier = Modifier.size(16.dp))
            Text("Files")
        }
        CrumbSeparator()
        if (atLibraryRoot) {
            Crumb(current = true) { Text(libraryName) }
            return@Row
        }
        Crumb(onClick = { onOpen("") }) { Text(libraryName) }
        summary?.ancestors?.forEach { crumb ->
            CrumbSeparator()
            Crumb(onClick = { onOpen(crumb.id) }) { Text(crumb.name) }
        }
        summary?.let {
            CrumbSeparator()
            Crumb(current = true) { Text(it.name) }
        }
    }
}

@Composable
private fun Crumb(
    current: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 6.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        CompositionLocalProvider(
            LocalContentColor provides if (current) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            LocalTextStyle provides MaterialTheme.typography.bodyMedium,
        ) { content() }
    }
}

@Composable
private fun CrumbSeparator() {
    Icon(
        Icons.AutoMirrored.Filled.KeyboardArrowRight,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(16.dp),
    )
}

internal fun folderSubtitle(folder: DirectoryChildPaged): String = listOfNotNull(
    folder.childCount?.let { formatCount(it.toInt(), "file") },
    folder.folderSize?.let { formatFileSize(it) },
).joinToString(" • ")

internal fun DirectoryChildPaged.toMenuTarget() = SongMenuTarget(
    id = id,
    title = title,
    artist = artist.orEmpty(),
    artistId = artistId?.takeIf { it.isNotBlank() },
    album = album,
    albumId = albumId,
    coverModel = inlineCoverModel(coverArtData),
    starred = starred != null,
    rating = userRating ?: 0,
)
