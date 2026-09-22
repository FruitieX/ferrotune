package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.ferrotune.core.designsystem.components.MediaActionRow

/**
 * Overflow action for song rows that adds the given songs to an editable
 * playlist. Hosts its own dialog so any feature can drop it into a row.
 */
@Composable
fun AddToPlaylistAction(
    songIds: List<String>,
    modifier: Modifier = Modifier,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var dialogOpen by remember { mutableStateOf(false) }

    Box(modifier) {
        IconButton(onClick = { menuExpanded = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = "More")
        }
        DropdownMenu(
            expanded = menuExpanded,
            onDismissRequest = { menuExpanded = false },
        ) {
            DropdownMenuItem(
                text = { Text("Add to playlist") },
                onClick = {
                    menuExpanded = false
                    dialogOpen = true
                },
            )
        }
    }

    if (dialogOpen) {
        AddToPlaylistDialog(
            songIds = songIds,
            onDismiss = { dialogOpen = false },
            onAdded = { dialogOpen = false },
        )
    }
}

@Composable
fun AddToPlaylistDialog(
    songIds: List<String>,
    onDismiss: () -> Unit,
    onAdded: () -> Unit,
    viewModel: AddToPlaylistViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(state.added) {
        if (state.added) onAdded()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add to playlist") },
        text = {
            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                state.error != null -> Text(
                    text = state.error!!,
                    color = MaterialTheme.colorScheme.error,
                )

                else -> LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                    item {
                        OutlinedTextField(
                            value = state.query,
                            onValueChange = viewModel::setQuery,
                            label = { Text("Search") },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp),
                        )
                    }
                    if (state.visiblePlaylists.isEmpty()) {
                        item {
                            Text(
                                text = "No editable playlists",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                    }
                    items(state.visiblePlaylists, key = { it.id }) { playlist ->
                        Text(
                            text = playlist.name,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !state.saving) {
                                    viewModel.add(songIds, playlist.id)
                                }
                                .padding(vertical = 12.dp),
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        },
    )
}

/**
 * Sheet-row variant of [AddToPlaylistAction] for shared action sheets.
 * The caller owns the dialog state and renders [AddToPlaylistDialog] itself.
 */
@Composable
fun AddToPlaylistMenuItem(
    onClick: () -> Unit,
) {
    MediaActionRow(
        icon = Icons.Filled.PlaylistAdd,
        label = "Add to playlist",
        onClick = onClick,
    )
}
