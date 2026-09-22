package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.max

/** Web `TOUCH_PROGRESS_PREVIEW_DURATION_MS`: keep the tapped-position label visible after a touch seek. */
private const val TOUCH_PREVIEW_DURATION_MS = 1000L

/** Web `ProgressTimeOverlay` label clamping: percent → left edge inside the container. */
internal fun progressTooltipLeft(percent: Float, labelWidth: Float, containerWidth: Float): Float {
    val clamped = percent.coerceIn(0f, 1f)
    val maxLeft = max(0f, containerWidth - labelWidth)
    return (clamped * containerWidth - labelWidth / 2f).coerceIn(0f, maxLeft)
}

/** Web `ProgressTimeOverlay` collision check between the current and scrub labels. */
internal fun progressTooltipsCollide(
    firstLeft: Float,
    firstWidth: Float,
    secondLeft: Float,
    secondWidth: Float,
    padding: Float,
): Boolean =
    firstLeft < secondLeft + secondWidth + padding &&
        secondLeft < firstLeft + firstWidth + padding

/**
 * Pre-computed waveform seek bar. Bars before [progress] are drawn in
 * [playedColor]; the rest use [trackColor]. When [onSeek] is set the bar is
 * tappable and draggable, reporting a 0..1 fraction, and scrubbing shows the
 * web client's progress affordances: a vertical position bar plus
 * start/end/current time tooltips that stay visible briefly after release.
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
    positionMs: Long = 0,
    durationMs: Long = 0,
) {
    if (heights.isEmpty()) return
    val clampedProgress = progress.coerceIn(0f, 1f)
    val showTooltips = onSeek != null && durationMs > 0
    val tooltipHeight = if (showTooltips) 22.dp else 0.dp

    var scrubFraction by remember { mutableStateOf<Float?>(null) }
    var previewVisible by remember { mutableStateOf(false) }
    var previewGeneration by remember { mutableIntStateOf(0) }
    var previewTimerEnabled by remember { mutableStateOf(false) }

    LaunchedEffect(previewGeneration, previewTimerEnabled) {
        if (!previewTimerEnabled) return@LaunchedEffect
        delay(TOUCH_PREVIEW_DURATION_MS)
        previewVisible = false
        scrubFraction = null
    }

    val textMeasurer = rememberTextMeasurer()
    val labelStyle = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    val labelBackground = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
    val labelBorder = MaterialTheme.colorScheme.outlineVariant
    val indicatorColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height + tooltipHeight),
    ) {
        Canvas(
            modifier = Modifier.fillMaxSize(),
        ) {
            val tooltipPx = tooltipHeight.toPx()
            val barTop = tooltipPx
            val barAreaHeight = size.height - tooltipPx
            if (barAreaHeight <= 0f) return@Canvas

            val step = (barWidth + barGap).toPx()
            if (step <= 0f) return@Canvas
            val barCount = max(1, (size.width / step).toInt())
            val barW = barWidth.toPx()
            val radius = CornerRadius(barW / 2f, barW / 2f)
            val playedBars = (barCount * clampedProgress).toInt()

            for (index in 0 until barCount) {
                val sampleIndex = (index.toLong() * heights.size / barCount)
                    .toInt()
                    .coerceIn(0, heights.size - 1)
                val sample = heights[sampleIndex].coerceIn(0f, 1f)
                val barHeight = max(barW, sample * barAreaHeight)
                val left = index * step
                val top = barTop + (barAreaHeight - barHeight) / 2f
                drawRoundRect(
                    color = if (index < playedBars) playedColor else trackColor,
                    topLeft = Offset(left, top),
                    size = Size(barW, barHeight),
                    cornerRadius = radius,
                )
            }

            if (!previewVisible || scrubFraction == null) return@Canvas
            val scrubPercent = scrubFraction!!.coerceIn(0f, 1f)

            val indicatorWidth = 2.dp.toPx()
            val indicatorHeight = barAreaHeight * 1.5f
            drawRect(
                color = indicatorColor,
                topLeft = Offset(
                    x = scrubPercent * size.width - indicatorWidth / 2f,
                    y = barTop + (barAreaHeight - indicatorHeight) / 2f,
                ),
                size = Size(indicatorWidth, indicatorHeight),
            )

            if (!showTooltips) return@Canvas
            val currentLayout = textMeasurer.measure(
                AnnotatedString(
                    "${formatClockDuration(positionMs)} / ${formatClockDuration(durationMs)}",
                ),
                labelStyle,
            )
            val scrubLayout = textMeasurer.measure(
                AnnotatedString(formatClockDuration((scrubPercent * durationMs).toLong())),
                labelStyle,
            )
            val horizontalPadding = 6.dp.toPx()
            val verticalPadding = 2.dp.toPx()
            val cornerRadius = CornerRadius(4.dp.toPx(), 4.dp.toPx())
            val currentWidth = currentLayout.size.width + horizontalPadding * 2
            val scrubWidth = scrubLayout.size.width + horizontalPadding * 2
            val currentLeft = progressTooltipLeft(clampedProgress, currentWidth, size.width)
            val scrubLeft = progressTooltipLeft(scrubPercent, scrubWidth, size.width)
            val hideCurrent = progressTooltipsCollide(
                firstLeft = currentLeft,
                firstWidth = currentWidth,
                secondLeft = scrubLeft,
                secondWidth = scrubWidth,
                padding = 8.dp.toPx(),
            )

            fun drawLabel(layout: TextLayoutResult, left: Float) {
                val width = layout.size.width + horizontalPadding * 2
                val labelHeight = tooltipPx - 2.dp.toPx()
                drawRoundRect(
                    color = labelBackground,
                    topLeft = Offset(left, 0f),
                    size = Size(width, labelHeight),
                    cornerRadius = cornerRadius,
                )
                drawRoundRect(
                    color = labelBorder,
                    topLeft = Offset(left, 0f),
                    size = Size(width, labelHeight),
                    cornerRadius = cornerRadius,
                    style = Stroke(1.dp.toPx()),
                )
                drawText(
                    textLayoutResult = layout,
                    topLeft = Offset(
                        left + horizontalPadding,
                        (labelHeight - layout.size.height) / 2f,
                    ),
                )
            }

            if (!hideCurrent) drawLabel(currentLayout, currentLeft)
            drawLabel(scrubLayout, scrubLeft)
        }

        if (onSeek != null) {
            // Only the bar area is interactive; the tooltip band stays
            // pointer-transparent like the web client's overlay.
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(height)
                    .pointerInput(onSeek) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            fun update(positionX: Float) {
                                if (size.width <= 0) return
                                val fraction = (positionX / size.width).coerceIn(0f, 1f)
                                scrubFraction = fraction
                                previewVisible = true
                                onSeek(fraction)
                            }
                            previewTimerEnabled = false
                            update(down.position.x)
                            drag(down.id) { change ->
                                update(change.position.x)
                                change.consume()
                            }
                            previewGeneration += 1
                            previewTimerEnabled = true
                        }
                    },
            )
        }
    }
}
