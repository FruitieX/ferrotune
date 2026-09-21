package com.ferrotune.feature.downloads.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

import com.ferrotune.feature.downloads.data.DownloadStatus

/**
 * Icon action for song rows: starts a download, shows progress, and removes
 * the download when tapped again. Hilt scopes the ViewModel to the host
 * screen, so every row shares one instance.
 */
@Composable
fun SongDownloadAction(
    songId: String,
    modifier: Modifier = Modifier,
    viewModel: DownloadActionViewModel = hiltViewModel(),
) {
    val downloadedIds by viewModel.downloadedSongIds.collectAsStateWithLifecycle()
    val states by viewModel.states.collectAsStateWithLifecycle()
    val state = states[songId]
    val isDownloaded = songId in downloadedIds

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        if (state?.status == DownloadStatus.DOWNLOADING) {
            Text(
                text = "${state.percent.toInt()}%",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 4.dp),
            )
        }
        IconButton(onClick = { viewModel.toggleSong(songId) }) {
            when {
                state?.isActive == true -> CircularProgressIndicator(
                    modifier = Modifier.padding(4.dp),
                    strokeWidth = 2.dp,
                )

                isDownloaded -> Icon(
                    Icons.Filled.DownloadDone,
                    contentDescription = "Remove download",
                    tint = MaterialTheme.colorScheme.primary,
                )

                state?.status == DownloadStatus.FAILED -> Icon(
                    Icons.Filled.Download,
                    contentDescription = "Retry download",
                    tint = MaterialTheme.colorScheme.error,
                )

                else -> Icon(Icons.Filled.Download, contentDescription = "Download")
            }
        }
    }
}

/**
 * Menu-item variant of [SongDownloadAction] for shared row overflow menus.
 */
@Composable
fun SongDownloadMenuItem(
    songId: String,
    onClick: () -> Unit,
    viewModel: DownloadActionViewModel = hiltViewModel(),
) {
    val downloadedIds by viewModel.downloadedSongIds.collectAsStateWithLifecycle()
    val isDownloaded = songId in downloadedIds

    androidx.compose.material3.DropdownMenuItem(
        text = { Text(if (isDownloaded) "Remove download" else "Download") },
        leadingIcon = {
            Icon(
                imageVector = if (isDownloaded) {
                    Icons.Filled.DownloadDone
                } else {
                    Icons.Filled.Download
                },
                contentDescription = null,
            )
        },
        onClick = {
            onClick()
            viewModel.toggleSong(songId)
        },
    )
}
