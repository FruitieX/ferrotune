package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Fixed height of a [TrackRow], for skeletons and scroll math. */
val TrackRowHeight = 56.dp

/**
 * Touch variant of the web `SongRow`/`MediaRow`: an optional index column
 * (track number, now-playing bars, or the selection checkbox), a 40dp cover,
 * title and muted subtitle, and right-aligned metadata such as the duration.
 * Tapping plays, long-pressing opens the action sheet; the current track is
 * tinted and highlighted like the web row.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TrackRow(
    title: String,
    subtitle: String?,
    coverModel: Any?,
    coverSeed: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    index: Int? = null,
    showIndexColumn: Boolean = index != null,
    isCurrent: Boolean = false,
    isPlaying: Boolean = false,
    showCover: Boolean = true,
    coverShape: Shape = RoundedCornerShape(4.dp),
    coverPlaceholder: ImageVector = Icons.Filled.MusicNote,
    duration: String? = null,
    selectionActive: Boolean = false,
    selected: Boolean = false,
    dimmed: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val background = when {
        selected -> colors.primary.copy(alpha = 0.15f)
        isCurrent -> colors.surfaceContainerHighest.copy(alpha = 0.3f)
        else -> Color.Transparent
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(TrackRowHeight)
            .background(background)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .alpha(if (dimmed) 0.45f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Web rows draw a 2dp primary left border on selected rows.
        Box(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(if (selected) colors.primary else Color.Transparent),
        )
        Row(
            modifier = Modifier
                .weight(1f)
                .padding(start = 14.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (showIndexColumn || selectionActive) {
                Box(modifier = Modifier.width(28.dp), contentAlignment = Alignment.Center) {
                    when {
                        selectionActive -> Checkbox(
                            checked = selected,
                            onCheckedChange = null,
                            modifier = Modifier.size(20.dp),
                        )

                        isCurrent -> NowPlayingBars(isAnimating = isPlaying)

                        index != null -> Text(
                            text = index.toString(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                        )
                    }
                }
            }
            if (showCover) {
                CoverArt(
                    model = coverModel,
                    contentDescription = null,
                    seed = coverSeed,
                    shape = coverShape,
                    placeholder = coverPlaceholder,
                    modifier = Modifier.size(40.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = if (isCurrent) colors.primary else colors.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            trailing?.invoke(this)
            if (duration != null) {
                Text(
                    text = duration,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontFeatureSettings = "tnum",
                        fontSize = 13.sp,
                    ),
                    color = colors.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}

/** Web track-list column header: "#", "Title", "Time" over a divider. */
@Composable
fun TrackListHeader(modifier: Modifier = Modifier, showIndex: Boolean = true) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showIndex) {
                Text("#", style = MaterialTheme.typography.labelMedium, color = muted, textAlign = TextAlign.Center, modifier = Modifier.width(28.dp))
            }
            Text("Title", style = MaterialTheme.typography.labelMedium, color = muted, modifier = Modifier.weight(1f))
            Text("Time", style = MaterialTheme.typography.labelMedium, color = muted)
        }
        androidx.compose.material3.HorizontalDivider(
            modifier = Modifier.padding(horizontal = 16.dp),
            color = MaterialTheme.colorScheme.outline,
        )
    }
}

/** Web "Disc N" label with a trailing rule, above the disc's first track. */
@Composable
fun TrackGroupHeader(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        androidx.compose.material3.HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outline,
        )
    }
}
