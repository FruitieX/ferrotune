package com.ferrotune.feature.player

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ferrotune.core.designsystem.components.WaveformBar
import com.ferrotune.core.designsystem.components.formatClockDuration

private fun fractionOf(positionMs: Long, durationMs: Long): Float =
    if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)

/**
 * The player's seek bar: the waveform when the server-synced
 * `progress-bar-style` is "waveform" and the track has one, a slider
 * otherwise. Reads the smoothly advancing position itself, so it is the only
 * part of the player that recomposes while playing.
 */
@Composable
internal fun PlayerSeekBar(
    progress: PlaybackProgress,
    style: String,
    waveformHeights: List<Float>,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
    waveformHeight: Dp = 40.dp,
    barWidth: Dp = 3.dp,
    barGap: Dp = 2.dp,
    showTimes: Boolean = true,
) {
    val position by rememberPlaybackPosition(progress)
    Column(modifier = modifier.fillMaxWidth()) {
        if (style == "waveform" && waveformHeights.isNotEmpty()) {
            WaveformBar(
                heights = waveformHeights,
                progress = fractionOf(position, progress.durationMs),
                onSeek = onSeek,
                positionMs = position,
                durationMs = progress.durationMs,
                height = waveformHeight,
                barWidth = barWidth,
                barGap = barGap,
            )
        } else {
            // While dragging, the thumb follows the finger; the seek is sent on release.
            var dragFraction by remember { mutableStateOf<Float?>(null) }
            Slider(
                value = dragFraction ?: fractionOf(position, progress.durationMs),
                onValueChange = { dragFraction = it },
                onValueChangeFinished = {
                    dragFraction?.let(onSeek)
                    dragFraction = null
                },
                enabled = progress.durationMs > 0,
                colors = SliderDefaults.colors(
                    inactiveTrackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
                ),
            )
        }
        if (showTimes) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val timeStyle = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum")
                Text(
                    formatClockDuration(position),
                    style = timeStyle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    formatClockDuration(progress.durationMs),
                    style = timeStyle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Thin mini-player progress line for the non-waveform style. */
@Composable
internal fun PlayerProgressLine(progress: PlaybackProgress, modifier: Modifier = Modifier) {
    val position by rememberPlaybackPosition(progress)
    LinearProgressIndicator(
        progress = { fractionOf(position, progress.durationMs) },
        modifier = modifier
            .fillMaxWidth()
            .height(3.dp),
        trackColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.5f),
        drawStopIndicator = {},
        gapSize = 0.dp,
    )
}
