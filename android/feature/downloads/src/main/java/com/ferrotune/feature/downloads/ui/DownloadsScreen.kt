package com.ferrotune.feature.downloads.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.database.DownloadedContainerEntity
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.SectionHeader
import com.ferrotune.core.designsystem.components.ShelfCard
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.TrackRow
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.feature.downloads.data.DownloadStatus
import com.ferrotune.feature.downloads.data.SongDownloadState

/** Flow tint for the Downloads collection (sky), like favorites red and history purple. */
private val DOWNLOADS_BACKDROP = Color(0x330EA5E9)
private val DOWNLOADS_ICON_GRADIENT = listOf(Color(0xFF38BDF8), Color(0xFF0369A1))

/**
 * Everything saved on this device. Playback here never needs the server, so
 * this is the page the offline states point to.
 */
@Composable
fun DownloadsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DownloadsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val nowPlaying = rememberNowPlaying()
    var songSheet by remember { mutableStateOf<DownloadedSongEntity?>(null) }
    var containerSheet by remember { mutableStateOf<DownloadedContainerEntity?>(null) }
    var overflowOpen by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = modifier,
    ) { padding ->
        val actionBar: @Composable () -> Unit = {
            DetailActionBar(
                onPlayAll = { viewModel.play() },
                onShuffle = { viewModel.play(shuffle = true) },
                playEnabled = state.songs.isNotEmpty(),
                actions = {
                    Spacer(Modifier.weight(1f))
                    Box {
                        IconButton(onClick = { overflowOpen = true }) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "More options")
                        }
                        DropdownMenu(expanded = overflowOpen, onDismissRequest = { overflowOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("Pause downloads") },
                                leadingIcon = { Icon(Icons.Filled.Pause, contentDescription = null) },
                                onClick = {
                                    overflowOpen = false
                                    viewModel.pauseAll()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Resume downloads") },
                                leadingIcon = { Icon(Icons.Filled.Download, contentDescription = null) },
                                onClick = {
                                    overflowOpen = false
                                    viewModel.resumeAll()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Remove all downloads", color = MaterialTheme.colorScheme.error) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Filled.DeleteOutline,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error,
                                    )
                                },
                                onClick = {
                                    overflowOpen = false
                                    confirmClear = true
                                },
                            )
                        }
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
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                item(key = "hero") {
                    DetailHero(backdropColor = DOWNLOADS_BACKDROP) {
                        DetailHeader(
                            title = "Downloads",
                            label = "On this device",
                            icon = Icons.Filled.DownloadDone,
                            iconGradient = DOWNLOADS_ICON_GRADIENT,
                            meta = downloadsMeta(state),
                            showBackButton = true,
                            onBack = onBack,
                        )
                    }
                }
                if (state.isEmpty) {
                    item(key = "empty") {
                        EmptyState(
                            message = "No downloads yet",
                            icon = Icons.Filled.Download,
                            description = "Download albums, playlists, or songs from their ⋯ menu to play them offline.",
                        )
                    }
                    return@LazyColumn
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                if (state.containers.isNotEmpty()) {
                    item(key = "containers-header") { SectionHeader("Albums & playlists") }
                    item(key = "containers") {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(state.containers, key = { it.container.containerId }) { item ->
                                val container = item.container
                                ShelfCard(
                                    title = container.name,
                                    subtitle = "${containerLabel(container.type)} • ${formatCount(item.songCount, "song")}",
                                    coverModel = coverModel(null, container.coverArtId),
                                    seed = container.containerId,
                                    titleIcon = containerIcon(container.type),
                                    onClick = { viewModel.playContainer(container) },
                                    onLongClick = { containerSheet = container },
                                )
                            }
                        }
                    }
                }
                if (state.songs.isNotEmpty()) {
                    item(key = "songs-header") {
                        SectionHeader(
                            title = "Songs",
                            subtitle = state.pendingCount.takeIf { it > 0 }?.let { "${formatCount(it, "song")} still downloading" },
                        )
                    }
                    item(key = "columns") { TrackListHeader(showIndex = false) }
                    items(state.songs, key = { it.songId }) { song ->
                        val isCurrent = nowPlaying.songId == song.songId
                        TrackRow(
                            title = song.title,
                            subtitle = listOfNotNull(song.artist, song.album).joinToString(" • "),
                            coverModel = inlineCoverModel(song.coverArtData),
                            coverSeed = song.albumId ?: song.songId,
                            onClick = { viewModel.play(song.songId) },
                            onLongClick = { songSheet = song },
                            isCurrent = isCurrent,
                            isPlaying = isCurrent && nowPlaying.isPlaying,
                            duration = formatClockDuration(song.duration * 1000),
                            trailing = { DownloadStatusIndicator(state.states[song.songId]) },
                        )
                    }
                }
            }
            PinnedActionBar(visible = actionBarPinned && !state.isEmpty) { actionBar() }
        }
    }

    val song = songSheet
    MediaActionSheet(
        expanded = song != null,
        onDismiss = { songSheet = null },
        title = song?.title,
        subtitle = song?.artist,
        coverModel = inlineCoverModel(song?.coverArtData),
        seed = song?.albumId ?: song?.songId,
        actions = song?.let {
            listOf(
                MediaAction("Play", Icons.Filled.PlayArrow) { viewModel.play(it.songId) },
                MediaAction("Remove download", Icons.Filled.DeleteOutline, separatorBefore = true, destructive = true) {
                    viewModel.removeSong(it)
                },
            )
        }.orEmpty(),
    )

    val container = containerSheet
    MediaActionSheet(
        expanded = container != null,
        onDismiss = { containerSheet = null },
        title = container?.name,
        subtitle = container?.let { containerLabel(it.type) },
        coverModel = coverModel(null, container?.coverArtId),
        seed = container?.containerId,
        placeholder = containerIcon(container?.type),
        actions = container?.let {
            listOf(
                MediaAction("Play", Icons.Filled.PlayArrow) { viewModel.playContainer(it) },
                MediaAction("Shuffle", Icons.Filled.Shuffle) { viewModel.playContainer(it, shuffle = true) },
                MediaAction("Remove download", Icons.Filled.DeleteOutline, separatorBefore = true, destructive = true) {
                    viewModel.removeContainer(it)
                },
            )
        }.orEmpty(),
    )

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Remove all downloads?") },
            text = { Text("Every downloaded song is deleted from this device. You can download them again while online.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClear = false
                    viewModel.clearAll()
                }) {
                    Text("Remove all", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmClear = false }) { Text("Cancel") }
            },
        )
    }
}

private fun downloadsMeta(state: DownloadsUiState): String? {
    if (state.isEmpty) return null
    val parts = mutableListOf(formatCount(state.songs.size, "song"))
    if (state.totalDurationSeconds > 0) parts += formatTotalDuration(state.totalDurationSeconds)
    return parts.joinToString(" • ")
}

private fun containerLabel(type: String): String = when (type) {
    DownloadContainerType.ALBUM -> "Album"
    DownloadContainerType.PLAYLIST -> "Playlist"
    DownloadContainerType.SMART_PLAYLIST -> "Smart playlist"
    DownloadContainerType.ARTIST -> "Artist"
    else -> "Collection"
}

private fun containerIcon(type: String?) = when (type) {
    DownloadContainerType.ALBUM -> Icons.Filled.Album
    else -> Icons.AutoMirrored.Filled.PlaylistPlay
}

/**
 * Finished downloads show nothing (everything on this page is downloaded);
 * only work in progress or problems get an indicator.
 */
@Composable
private fun DownloadStatusIndicator(state: SongDownloadState?) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    when (state?.status) {
        DownloadStatus.DOWNLOADING -> CircularProgressIndicator(
            progress = { (state.percent / 100f).coerceIn(0f, 1f) },
            modifier = Modifier.size(18.dp),
            strokeWidth = 2.dp,
        )
        DownloadStatus.QUEUED -> Icon(Icons.Filled.Schedule, contentDescription = "Queued", tint = muted, modifier = Modifier.size(18.dp))
        DownloadStatus.PAUSED -> Icon(Icons.Filled.Pause, contentDescription = "Paused", tint = muted, modifier = Modifier.size(18.dp))
        DownloadStatus.FAILED -> Icon(
            Icons.Filled.ErrorOutline,
            contentDescription = "Download failed",
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(18.dp),
        )
        else -> Unit
    }
}
