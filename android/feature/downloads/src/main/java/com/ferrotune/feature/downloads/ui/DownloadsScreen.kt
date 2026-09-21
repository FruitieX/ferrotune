package com.ferrotune.feature.downloads.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.database.ContainerWithCount
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.feature.downloads.data.DownloadSettings
import com.ferrotune.feature.downloads.data.DownloadStatus
import com.ferrotune.feature.downloads.data.SongDownloadState

@Composable
fun DownloadsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DownloadsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var menuExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissMessage()
        }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Downloads") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(
                            expanded = menuExpanded,
                            onDismissRequest = { menuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (settings.wifiOnly) {
                                            "Wi-Fi only downloads: on"
                                        } else {
                                            "Wi-Fi only downloads: off"
                                        },
                                    )
                                },
                                onClick = { viewModel.setWifiOnly(!settings.wifiOnly) },
                            )
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (settings.format == DownloadSettings.FORMAT_OPUS) {
                                            "Format: Opus"
                                        } else {
                                            "Format: Original"
                                        },
                                    )
                                },
                                onClick = {
                                    viewModel.setFormat(
                                        if (settings.format == DownloadSettings.FORMAT_OPUS) {
                                            DownloadSettings.FORMAT_ORIGINAL
                                        } else {
                                            DownloadSettings.FORMAT_OPUS
                                        },
                                    )
                                },
                            )
                            if (settings.format == DownloadSettings.FORMAT_OPUS) {
                                DropdownMenuItem(
                                    text = { Text("Bitrate: ${settings.bitRateKbps} kbps") },
                                    onClick = {
                                        val rates = DownloadSettings.BIT_RATES
                                        val next = rates[(rates.indexOf(settings.bitRateKbps) + 1) % rates.size]
                                        viewModel.setBitRate(next)
                                    },
                                )
                            }
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Pause all") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.pauseAll()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Resume all") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.resumeAll()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Clear all downloads") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.clearAll()
                                },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (state.songs.isEmpty() && state.containers.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                EmptyState("No downloads yet")
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            if (state.containers.isNotEmpty()) {
                item {
                    SectionHeader("Saved albums & playlists")
                }
                items(state.containers, key = { it.container.containerId }) { container ->
                    ContainerRow(
                        container = container,
                        onRemove = { viewModel.removeContainer(container.container.containerId) },
                    )
                }
            }
            if (state.songs.isNotEmpty()) {
                item {
                    SectionHeader("Songs")
                }
                items(state.songs, key = { it.songId }) { song ->
                    DownloadSongRow(
                        song = song,
                        state = state.states[song.songId],
                        onPlay = { viewModel.play(song.songId) },
                        onRemove = { viewModel.removeSong(song.songId) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun ContainerRow(
    container: ContainerWithCount,
    onRemove: () -> Unit,
) {
    val entity = container.container
    MediaRow(
        title = entity.name,
        subtitle = "${entity.type.replaceFirstChar { it.uppercase() }} • ${container.songCount} songs",
        coverModel = null,
        onClick = {},
        trailing = {
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Delete, contentDescription = "Remove download")
            }
        },
    )
}

@Composable
private fun DownloadSongRow(
    song: DownloadedSongEntity,
    state: SongDownloadState?,
    onPlay: () -> Unit,
    onRemove: () -> Unit,
) {
    MediaRow(
        title = song.title,
        subtitle = listOfNotNull(song.artist, downloadSubtitle(state)).joinToString(" • "),
        coverModel = inlineCoverModel(song.coverArtData),
        onClick = onPlay,
        trailing = {
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Delete, contentDescription = "Remove download")
            }
        },
    )
}

private fun downloadSubtitle(state: SongDownloadState?): String? = when (state?.status) {
    DownloadStatus.DOWNLOADING -> "${state.percent.toInt()}%"
    DownloadStatus.QUEUED -> "Queued"
    DownloadStatus.PAUSED -> "Paused"
    DownloadStatus.FAILED -> "Failed"
    else -> null
}
