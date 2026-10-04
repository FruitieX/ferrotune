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

import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.feature.downloads.data.DownloadStatus

/**
 * "Download" / "Remove download" row for a song in shared action sheets.
 */
@Composable
fun SongDownloadMenuItem(
    songId: String,
    onClick: () -> Unit = {},
    viewModel: DownloadActionViewModel = hiltViewModel(),
) {
    val downloadedIds by viewModel.downloadedSongIds.collectAsStateWithLifecycle()
    val isDownloaded = songId in downloadedIds

    MediaActionRow(
        icon = if (isDownloaded) Icons.Filled.DownloadDone else Icons.Filled.Download,
        label = if (isDownloaded) "Remove download" else "Download",
        onClick = {
            onClick()
            viewModel.toggleSong(songId)
        },
    )
}
