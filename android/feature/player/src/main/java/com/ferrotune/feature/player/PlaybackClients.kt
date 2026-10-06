package com.ferrotune.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.network.generated.ClientResponse

/**
 * Web `FollowerIndicator`: while another client owns the session, a strip
 * above the player says where the music is playing; tapping it lists the
 * connected clients so playback can be moved (including back to this phone).
 *
 * The bottom padding leaves room for the mini player's waveform, which
 * straddles the bar's top edge.
 */
@Composable
fun PlaybackOwnerStrip(
    modifier: Modifier = Modifier,
    viewModel: PlaybackClientsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var sheetOpen by remember { mutableStateOf(false) }
    if (!state.isFollowing) return

    val primary = MaterialTheme.colorScheme.primary
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(primary.copy(alpha = 0.10f))
            .padding(top = 6.dp, bottom = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable {
                    viewModel.refresh()
                    sheetOpen = true
                }
                .padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                clientIcon(state.ownerClientName),
                contentDescription = null,
                tint = primary,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = state.castingTo?.let { "Casting to $it" }
                    ?: "Playing on ${state.ownerDisplayName ?: friendlyClientName(state.ownerClientName)}",
                style = MaterialTheme.typography.labelMedium,
                color = primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    PlaybackClientsSheet(
        expanded = sheetOpen,
        onDismiss = { sheetOpen = false },
        state = state,
        onSelect = viewModel::transferTo,
    )
}

@Composable
private fun PlaybackClientsSheet(
    expanded: Boolean,
    onDismiss: () -> Unit,
    state: PlaybackClientsUiState,
    onSelect: (ClientResponse) -> Unit,
) {
    MediaActionSheet(
        expanded = expanded,
        onDismiss = onDismiss,
        actions = emptyList(),
        title = "Playback clients",
        subtitle = "Choose where music plays",
        placeholder = Icons.Filled.Devices,
        extraContent = {
            if (state.clients.isEmpty()) {
                Text(
                    "Looking for connected clients…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp),
                )
            }
            state.clients.forEach { client ->
                val isMe = client.clientId == state.myClientId
                val detail = client.deviceLabel ?: client.networkLabel
                MediaActionRow(
                    icon = clientIcon(client.clientName),
                    label = buildString {
                        append(client.displayName)
                        if (isMe) append(" (this phone)")
                        if (detail != null && detail != client.displayName) append(" · ").append(detail)
                    },
                    onClick = { onSelect(client) },
                    closesSheet = true,
                    trailing = if (client.isOwner) {
                        {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = "Playing here",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    } else {
                        null
                    },
                )
            }
        },
    )
}

private fun clientIcon(clientName: String?): ImageVector = when {
    clientName == null -> Icons.Filled.Devices
    clientName.startsWith("cast") || clientName.contains("cast", ignoreCase = true) -> Icons.Filled.Cast
    clientName == "ferrotune-mobile" -> Icons.Filled.Smartphone
    else -> Icons.Filled.Computer
}

/** Fallback before the client list (with display names) has loaded. */
internal fun friendlyClientName(clientName: String?): String = when {
    clientName == null -> "another device"
    clientName.contains("cast", ignoreCase = true) -> "a Cast device"
    clientName == "ferrotune-mobile" -> "another phone"
    clientName.startsWith("ferrotune-web") -> "the web player"
    else -> "another device"
}
