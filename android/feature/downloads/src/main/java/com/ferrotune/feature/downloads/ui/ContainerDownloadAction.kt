package com.ferrotune.feature.downloads.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.database.DownloadContainerType

enum class ContainerDownloadType(val apiValue: String) {
    ALBUM("album"),
    PLAYLIST("playlist"),
    SMART_PLAYLIST("smartPlaylist"),
}

/**
 * Top-bar action for album/playlist detail screens: downloads every song in
 * the container, or removes the container download when already saved.
 */
@Composable
fun ContainerDownloadAction(
    type: ContainerDownloadType,
    sourceId: String,
    name: String,
    coverArtId: String?,
    modifier: Modifier = Modifier,
    viewModel: DownloadActionViewModel = hiltViewModel(),
) {
    val downloadedContainerIds by viewModel.downloadedContainerIds.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val containerId = DownloadContainerType.id(type.apiValue, sourceId)
    val isDownloaded = containerId in downloadedContainerIds
    val isBusy = sourceId in busy

    IconButton(
        modifier = modifier,
        onClick = {
            if (isDownloaded) {
                viewModel.removeContainer(containerId)
            } else {
                when (type) {
                    ContainerDownloadType.ALBUM ->
                        viewModel.downloadAlbum(sourceId, name, coverArtId)

                    ContainerDownloadType.PLAYLIST ->
                        viewModel.downloadPlaylist(sourceId, name, coverArtId)

                    ContainerDownloadType.SMART_PLAYLIST ->
                        viewModel.downloadSmartPlaylist(sourceId, name, coverArtId)
                }
            }
        },
    ) {
        when {
            isBusy -> CircularProgressIndicator(
                modifier = Modifier.padding(4.dp),
                strokeWidth = 2.dp,
            )

            isDownloaded -> Icon(
                Icons.Filled.DownloadDone,
                contentDescription = "Remove download",
                tint = MaterialTheme.colorScheme.primary,
            )

            else -> Icon(Icons.Filled.Download, contentDescription = "Download")
        }
    }
}
