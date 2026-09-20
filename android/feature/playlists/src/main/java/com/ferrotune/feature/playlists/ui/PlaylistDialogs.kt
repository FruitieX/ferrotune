package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ferrotune.feature.playlists.data.PlaylistFolderNode

@Composable
fun NameDialog(
    title: String,
    initialValue: String = "",
    confirmLabel: String = "Save",
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initialValue) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(value.trim()) },
                enabled = value.isNotBlank(),
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String = "Delete",
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

/**
 * Flat folder picker. [excludeIds] hides folders that cannot be selected
 * (for example the folder being moved and its descendants).
 */
@Composable
fun FolderPickerDialog(
    title: String,
    nodes: List<PlaylistFolderNode>,
    excludeIds: Set<String> = emptySet(),
    rootLabel: String = "No folder",
    onDismiss: () -> Unit,
    onSelect: (String?) -> Unit,
) {
    val flatFolders = remember(nodes, excludeIds) { flattenFolders(nodes, excludeIds) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    text = rootLabel,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(null) }
                        .padding(vertical = 12.dp),
                )
                flatFolders.forEach { (folder, depth) ->
                    Text(
                        text = "  ".repeat(depth) + folder.name,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(folder.id) }
                            .padding(vertical = 12.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

private fun flattenFolders(
    nodes: List<PlaylistFolderNode>,
    excludeIds: Set<String>,
): List<Pair<com.ferrotune.core.network.generated.PlaylistFolderResponse, Int>> {
    val result = mutableListOf<Pair<com.ferrotune.core.network.generated.PlaylistFolderResponse, Int>>()
    fun visit(node: PlaylistFolderNode) {
        if (node.folder.id in excludeIds) return
        result += node.folder to node.depth
        node.children.forEach(::visit)
    }
    nodes.forEach(::visit)
    return result
}
