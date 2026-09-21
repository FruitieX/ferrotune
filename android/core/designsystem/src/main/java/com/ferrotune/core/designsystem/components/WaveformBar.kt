package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/**
 * Pre-computed waveform seek bar. Bars before [progress] are drawn in
 * [playedColor]; the rest use [trackColor]. When [onSeek] is set the bar is
 * tappable and draggable, reporting a 0..1 fraction.
 */
@Composable
fun WaveformBar(
    heights: List<Float>,
    progress: Float,
    modifier: Modifier = Modifier,
    height: Dp = 32.dp,
    barWidth: Dp = 2.dp,
    barGap: Dp = 2.dp,
    playedColor: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
    onSeek: ((Float) -> Unit)? = null,
) {
    if (heights.isEmpty()) return
    val clampedProgress = progress.coerceIn(0f, 1f)

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .then(
                if (onSeek == null) {
                    Modifier
                } else {
                    Modifier.pointerInput(onSeek) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            if (size.width > 0) {
                                onSeek((down.position.x / size.width).coerceIn(0f, 1f))
                            }
                            drag(down.id) { change ->
                                if (size.width > 0) {
                                    onSeek((change.position.x / size.width).coerceIn(0f, 1f))
                                }
                                change.consume()
                            }
                        }
                    }
                },
            ),
    ) {
        val step = (barWidth + barGap).toPx()
        if (step <= 0f) return@Canvas
        val barCount = max(1, (size.width / step).toInt())
        val barW = barWidth.toPx()
        val radius = CornerRadius(barW / 2f, barW / 2f)
        val maxBarHeight = size.height
        val playedBars = (barCount * clampedProgress).toInt()

        for (index in 0 until barCount) {
            val sampleIndex = (index.toLong() * heights.size / barCount)
                .toInt()
                .coerceIn(0, heights.size - 1)
            val sample = heights[sampleIndex].coerceIn(0f, 1f)
            val barHeight = max(barW, sample * maxBarHeight)
            val left = index * step
            val top = (maxBarHeight - barHeight) / 2f
            drawRoundRect(
                color = if (index < playedBars) playedColor else trackColor,
                topLeft = Offset(left, top),
                size = Size(barW, barHeight),
                cornerRadius = radius,
            )
        }
    }
}
