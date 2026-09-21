package com.ferrotune.core.actions

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Screen-local multi-select state for song lists. Selection mode is active
 * whenever at least one song is selected, matching the web client.
 */
@Stable
class SongSelectionState {
    var selectedIds by mutableStateOf<Set<String>>(emptySet())
        private set

    val isActive: Boolean get() = selectedIds.isNotEmpty()
    val count: Int get() = selectedIds.size

    fun toggle(songId: String) {
        selectedIds = if (songId in selectedIds) selectedIds - songId else selectedIds + songId
    }

    fun select(songId: String) {
        selectedIds = selectedIds + songId
    }

    fun replace(songIds: Collection<String>) {
        selectedIds = songIds.toSet()
    }

    fun clear() {
        selectedIds = emptySet()
    }
}

@Composable
fun rememberSongSelectionState(): SongSelectionState = remember { SongSelectionState() }

/**
 * Top bar shown while selection is active: count, exit, and select-all.
 * Screens swap this in place of their normal top bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SongSelectionTopBar(
    selectedCount: Int,
    onClose: () -> Unit,
    onSelectAll: (() -> Unit)? = null,
    selectingAll: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = { Text("$selectedCount selected") },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "Exit selection")
            }
        },
        actions = {
            if (onSelectAll != null) {
                IconButton(onClick = onSelectAll, enabled = !selectingAll) {
                    if (selectingAll) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(Icons.Filled.SelectAll, contentDescription = "Select all")
                    }
                }
            }
            actions()
        },
    )
}

/**
 * Bottom action bar for a song selection: play next, add to queue, and
 * favorite/unfavorite. Features append their own actions (playlist,
 * download) via [extraActions] and decide when to clear the selection.
 */
@Composable
fun SongSelectionActionBar(
    selectedIds: List<String>,
    onClearSelection: () -> Unit,
    modifier: Modifier = Modifier,
    extraActions: (@Composable (List<String>) -> Unit)? = null,
    viewModel: SongActionsViewModel = hiltViewModel(),
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SongSelectionAction(Icons.Filled.PlaylistPlay, "Play next") {
                viewModel.playNext(selectedIds)
                onClearSelection()
            }
            SongSelectionAction(Icons.Filled.QueueMusic, "Queue") {
                viewModel.addToQueue(selectedIds)
                onClearSelection()
            }
            SongSelectionAction(Icons.Filled.StarBorder, "Favorite") {
                viewModel.setStarredBulk(selectedIds, starred = true)
                onClearSelection()
            }
            SongSelectionAction(Icons.Filled.Star, "Unfavorite") {
                viewModel.setStarredBulk(selectedIds, starred = false)
                onClearSelection()
            }
            extraActions?.invoke(selectedIds)
        }
    }
}

/** One icon+label action inside [SongSelectionActionBar], shared by features. */
@Composable
fun SongSelectionAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
