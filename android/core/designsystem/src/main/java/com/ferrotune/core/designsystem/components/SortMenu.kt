package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

data class SortOption(
    val key: String,
    val label: String,
)

/**
 * Sort control matching the web client's `ArrowUpDown` dropdown: a single icon
 * button opening a "Sort by" menu, where the selected field shows the current
 * direction and a final item toggles it. Selection is applied server-side.
 */
@Composable
fun SortMenu(
    options: List<SortOption>,
    selectedKey: String,
    ascending: Boolean,
    onSelect: (String) -> Unit,
    onToggleDirection: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        IconButton(onClick = { expanded = true }) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Sort,
                contentDescription = "Sort",
                modifier = Modifier.size(22.dp),
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = {
                    Text(
                        text = "Sort by",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
                onClick = {},
                enabled = false,
            )
            HorizontalDivider()
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    onClick = {
                        expanded = false
                        onSelect(option.key)
                    },
                    trailingIcon = {
                        if (option.key == selectedKey) {
                            Icon(
                                imageVector = if (ascending) {
                                    Icons.Filled.ArrowUpward
                                } else {
                                    Icons.Filled.ArrowDownward
                                },
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    },
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text(if (ascending) "Descending" else "Ascending") },
                onClick = {
                    expanded = false
                    onToggleDirection()
                },
            )
        }
    }
}

/**
 * Sort rows for the ⋯ action sheet (the web drawer's "Sort" group): the
 * active field shows its direction, and choosing it again flips the
 * direction, matching the web toolbar's `handleSort`.
 */
@Composable
fun SortSheetSection(
    options: List<SortOption>,
    selectedKey: String,
    ascending: Boolean,
    onSelect: (String) -> Unit,
    onToggleDirection: () -> Unit,
) {
    MediaActionSeparator()
    Text(
        text = "Sort by",
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
    options.forEach { option ->
        val selected = option.key == selectedKey
        MediaActionRow(
            icon = Icons.AutoMirrored.Filled.Sort,
            label = option.label,
            onClick = { if (selected) onToggleDirection() else onSelect(option.key) },
            trailing = if (selected) {
                {
                    Icon(
                        imageVector = if (ascending) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                        contentDescription = if (ascending) "Ascending" else "Descending",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                null
            },
        )
    }
}

/**
 * "View as" rows for a ⋯ sheet: the web toolbar's grid/list toggle. Placed
 * above [SortSheetSection] on collection pages.
 */
@Composable
fun ViewModeSheetSection(
    isList: Boolean,
    onSelect: (isList: Boolean) -> Unit,
) {
    MediaActionSeparator()
    Text(
        text = "View as",
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
    listOf(false to "Grid", true to "List").forEach { (list, label) ->
        MediaActionRow(
            icon = if (list) Icons.AutoMirrored.Filled.ViewList else Icons.Filled.GridView,
            label = label,
            onClick = { onSelect(list) },
            trailing = if (list == isList) {
                {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = "Selected",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                null
            },
        )
    }
}

