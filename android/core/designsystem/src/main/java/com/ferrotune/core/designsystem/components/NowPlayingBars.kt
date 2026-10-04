package com.ferrotune.core.designsystem.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

private val PAUSED_HEIGHTS = floatArrayOf(0.5f, 0.83f, 0.5f, 0.67f)
private val BAR_DURATIONS_MS = intArrayOf(400, 500, 350, 450)

/**
 * Port of the web `NowPlayingBars`: four 3dp primary bars in a 12dp box that
 * bounce while [isAnimating] and rest at fixed heights when paused. Heights
 * are read in the draw phase, so the animation never recomposes the row.
 */
@Composable
fun NowPlayingBars(
    isAnimating: Boolean,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
) {
    val heights: List<State<Float>>? = if (isAnimating) {
        val transition = rememberInfiniteTransition(label = "now-playing-bars")
        BAR_DURATIONS_MS.map { duration ->
            transition.animateFloat(
                initialValue = 0.25f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(duration), RepeatMode.Reverse),
                label = "bar",
            )
        }
    } else {
        null
    }
    val description = if (isAnimating) "Now playing" else "Paused"
    Canvas(
        modifier = modifier
            .size(width = 18.dp, height = 12.dp)
            .semantics { contentDescription = description },
    ) {
        val barWidth = 3.dp.toPx()
        val gap = 2.dp.toPx()
        val total = barWidth * 4 + gap * 3
        var x = (size.width - total) / 2f
        for (i in 0 until 4) {
            val fraction = heights?.get(i)?.value ?: PAUSED_HEIGHTS[i]
            val barHeight = size.height * fraction
            drawRoundRect(
                color = color,
                topLeft = Offset(x, size.height - barHeight),
                size = Size(barWidth, barHeight),
                cornerRadius = CornerRadius(1.dp.toPx()),
            )
            x += barWidth + gap
        }
    }
}
