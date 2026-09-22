package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Circular play/shuffle action row matching the web client's `ActionBar`
 * (primary 48dp play button plus an outlined shuffle button, with room for
 * screen-specific actions).
 */
@Composable
fun DetailActionBar(
    modifier: Modifier = Modifier,
    onPlayAll: (() -> Unit)? = null,
    onShuffle: (() -> Unit)? = null,
    playEnabled: Boolean = true,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (onPlayAll != null) {
            FilledIconButton(
                onClick = onPlayAll,
                enabled = playEnabled,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = "Play",
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        if (onShuffle != null) {
            OutlinedIconButton(
                onClick = onShuffle,
                enabled = playEnabled,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Shuffle,
                    contentDescription = "Shuffle",
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        if (actions != null) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                content = actions,
            )
        } else if (onPlayAll != null || onShuffle != null) {
            Row(modifier = Modifier.weight(1f)) {}
        }
    }
}
