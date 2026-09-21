package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Star toggle used in rows, headers, and the now-playing screen. */
@Composable
fun StarButton(
    isStarred: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    iconSize: Dp = 22.dp,
) {
    IconButton(onClick = onToggle, enabled = enabled, modifier = modifier) {
        Icon(
            imageVector = if (isStarred) Icons.Filled.Star else Icons.Outlined.StarBorder,
            contentDescription = if (isStarred) "Remove from favorites" else "Add to favorites",
            tint = if (isStarred) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(iconSize),
        )
    }
}

/**
 * Five-star rating control. Tapping the current rating clears it, matching the
 * web client.
 */
@Composable
fun RatingStars(
    rating: Int,
    onRate: (Int) -> Unit,
    modifier: Modifier = Modifier,
    starSize: Dp = 20.dp,
) {
    Row(modifier = modifier) {
        for (value in 1..5) {
            Icon(
                imageVector = if (value <= rating) Icons.Filled.Star else Icons.Outlined.StarBorder,
                contentDescription = "Rate $value",
                tint = if (value <= rating) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier
                    .size(starSize)
                    .clickable { onRate(if (value == rating) 0 else value) },
            )
        }
    }
}

/** Non-interactive rating display. */
@Composable
fun RatingStarsDisplay(
    rating: Int,
    modifier: Modifier = Modifier,
    starSize: Dp = 14.dp,
) {
    if (rating <= 0) return
    Row(modifier = modifier) {
        for (value in 1..rating.coerceAtMost(5)) {
            Icon(
                imageVector = Icons.Filled.Star,
                contentDescription = null,
                tint = Color(0xFFE0A82E),
                modifier = Modifier.size(starSize),
            )
        }
    }
}
