package com.ferrotune.core.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

data class PillTab(
    val label: String,
    /** Shown after the label in a quieter style; null hides it. */
    val count: Long? = null,
)

/**
 * Horizontally scrolling row of rounded filter pills (search result
 * categories): the active pill is filled with the foreground color, the
 * others sit on the secondary surface, and counts trail each label.
 */
@Composable
fun PillTabRow(
    tabs: List<PillTab>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp),
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        itemsIndexed(tabs, key = { _, tab -> tab.label }) { index, tab ->
            val selected = index == selectedIndex
            val container by animateColorAsState(
                if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.secondary,
                label = "pillContainer",
            )
            val content by animateColorAsState(
                if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                label = "pillContent",
            )
            Row(
                modifier = Modifier
                    .height(34.dp)
                    .clip(CircleShape)
                    .background(container)
                    .clickable(role = Role.Tab) { onSelect(index) }
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = tab.label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = content,
                )
                if (tab.count != null) {
                    Text(
                        text = tab.count.toString(),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = content.copy(alpha = 0.6f),
                    )
                }
            }
        }
    }
}
