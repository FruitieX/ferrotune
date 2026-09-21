package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * List row with leading cover art, title/subtitle, and optional trailing
 * content (menus, toggles).
 *
 * When [onToggleSelection] is provided the row participates in multi-select:
 * a checkbox appears while selection is active and tapping toggles it.
 * [onLongClick] usually enters selection mode.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaRow(
    title: String,
    subtitle: String?,
    coverModel: Any?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    coverShape: Shape = RoundedCornerShape(10.dp),
    coverSeed: String? = null,
    trailing: @Composable (() -> Unit)? = null,
    isSelectionActive: Boolean = false,
    isSelected: Boolean = false,
    onToggleSelection: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val selectionEnabled = onToggleSelection != null
    val rowClick = if (selectionEnabled && isSelectionActive) onToggleSelection else onClick
    val clickModifier = if (onLongClick != null) {
        Modifier.combinedClickable(onClick = rowClick, onLongClick = onLongClick)
    } else {
        Modifier.clickable(onClick = rowClick)
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(
                if (selectionEnabled && isSelected) {
                    MaterialTheme.colorScheme.surfaceContainerHighest
                } else {
                    Color.Transparent
                },
            )
            .then(clickModifier)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (selectionEnabled && isSelectionActive) {
            Checkbox(
                checked = isSelected,
                onCheckedChange = null,
                modifier = Modifier.size(24.dp),
            )
        }
        CoverArt(
            model = coverModel,
            contentDescription = null,
            seed = coverSeed,
            shape = coverShape,
            modifier = Modifier.size(48.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.invoke()
    }
}
