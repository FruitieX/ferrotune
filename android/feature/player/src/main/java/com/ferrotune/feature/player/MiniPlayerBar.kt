package com.ferrotune.feature.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.inlineCoverModel
import kotlin.math.abs

@Composable
fun MiniPlayerBar(
    onOpenNowPlaying: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val track = state.track ?: return

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shadowElevation = 8.dp,
    ) {
        Column(
            modifier = Modifier
                .clickable(onClick = onOpenNowPlaying)
                .pointerInput(Unit) {
                    var totalX = 0f
                    var totalY = 0f
                    var vertical: Boolean? = null
                    detectDragGestures(
                        onDragStart = {
                            totalX = 0f
                            totalY = 0f
                            vertical = null
                        },
                        onDragEnd = {
                            if (vertical == true) {
                                if (totalY < -48.dp.toPx()) onOpenNowPlaying()
                            } else if (abs(totalX) > 80.dp.toPx()) {
                                if (totalX > 0) viewModel.previous() else viewModel.next()
                            }
                        },
                        onDragCancel = {},
                        onDrag = { change, amount ->
                            change.consume()
                            if (vertical == null && (abs(amount.x) > 2f || abs(amount.y) > 2f)) {
                                vertical = abs(amount.y) >= abs(amount.x)
                            }
                            if (vertical == true) {
                                totalY += amount.y
                            } else {
                                totalX += amount.x
                            }
                        },
                    )
                },
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CoverArt(
                    model = inlineCoverModel(track.coverArtData) ?: track.coverArtUrl,
                    contentDescription = track.title,
                    seed = track.id,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.size(40.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = track.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = viewModel::togglePlayPause) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (state.isPlaying) "Pause" else "Play",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(30.dp),
                    )
                }
                IconButton(onClick = viewModel::next) {
                    Icon(
                        imageVector = Icons.Filled.SkipNext,
                        contentDescription = "Next track",
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
            LinearProgressIndicator(
                progress = { state.progressFraction },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp),
                trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
            )
        }
    }
}
