package com.ferrotune.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.CastConnected
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.WaveformBar
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.media.TrackInfo
import kotlin.math.abs
import kotlin.math.max
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SWIPE_THRESHOLD = 50.dp
private const val SWIPE_VELOCITY_THRESHOLD = 300f
private const val SWIPE_COMMIT_TIMEOUT_MS = 3000L
private val PREVIEW_GAP = 16.dp
private val WAVEFORM_HEIGHT = 20.dp
private val WAVEFORM_TOOLTIP_HEIGHT = 22.dp

/**
 * Web-matching mini player: 88dp tall, flat translucent background, 56dp
 * cover, and the scrubable progress strip straddling the top edge. Renders a
 * "Not playing" placeholder when the queue is empty so the shell height stays
 * stable.
 */
@Composable
fun MiniPlayerBar(
    onOpenNowPlaying: () -> Unit,
    onExpandDrag: (Float) -> Unit,
    onExpandDragEnd: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val track = state.track
    var queueOpen by remember { mutableStateOf(false) }

    Box(modifier = modifier.fillMaxWidth()) {
        Surface(color = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)) {
            Box {
                if (track == null) {
                    NotPlayingRow(onOpenNowPlaying)
                } else {
                    NowPlayingRow(
                        state = state,
                        track = track,
                        onOpenNowPlaying = onOpenNowPlaying,
                        onExpandDrag = onExpandDrag,
                        onExpandDragEnd = onExpandDragEnd,
                        onOpenQueue = { queueOpen = true },
                        viewModel = viewModel,
                    )
                }

                if (state.progressBarStyle != "waveform" || state.waveformHeights.isEmpty()) {
                    LinearProgressIndicator(
                        progress = { state.progressFraction },
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .fillMaxWidth()
                            .height(4.dp),
                        trackColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.5f),
                    )
                }
            }
        }

        // Keep the waveform outside the clipping Surface so its overhang (and
        // touch target) straddles the bar's top edge like the web client.
        if (state.progressBarStyle == "waveform" && state.waveformHeights.isNotEmpty()) {
            val tooltipHeight = if (state.durationMs > 0) WAVEFORM_TOOLTIP_HEIGHT else 0.dp
            WaveformBar(
                heights = state.waveformHeights,
                progress = state.progressFraction,
                onSeek = viewModel::seekToFraction,
                positionMs = state.positionMs,
                durationMs = state.durationMs,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .offset {
                        IntOffset(0, -(WAVEFORM_HEIGHT / 2 + tooltipHeight).roundToPx())
                    }
                    .padding(horizontal = 16.dp),
                height = WAVEFORM_HEIGHT,
                barWidth = 2.dp,
                barGap = 2.dp,
            )
        }
    }

    if (queueOpen) {
        QueueSheet(onDismiss = { queueOpen = false })
    }
}

/**
 * Placeholder shown while the queue is empty so the shell height stays stable.
 */
@Composable
private fun NotPlayingRow(onOpenNowPlaying: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(88.dp)
            .clickable(onClick = onOpenNowPlaying)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(6.dp),
                ),
        )
        Text(
            text = "Not playing",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun NowPlayingRow(
    state: PlayerUiState,
    track: TrackInfo,
    onOpenNowPlaying: () -> Unit,
    onExpandDrag: (Float) -> Unit,
    onExpandDragEnd: () -> Unit,
    onOpenQueue: () -> Unit,
    viewModel: PlayerViewModel,
) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val swipeOffset = remember { Animatable(0f) }
    var infoWidthPx by remember { mutableIntStateOf(0) }
    val gapPx = with(LocalDensity.current) { PREVIEW_GAP.toPx() }
    val thresholdPx = with(LocalDensity.current) { SWIPE_THRESHOLD.toPx() }
    val distancePx = (infoWidthPx + gapPx).toFloat()
    val tapSlopPx = with(LocalDensity.current) { 20.dp.toPx() }
    var pendingTrackId by remember { mutableStateOf<String?>(null) }

    // The incoming preview is already centered when the commit lands, so once
    // the new track arrives the offset snaps back to rest without a jump.
    LaunchedEffect(track.id) {
        val pending = pendingTrackId
        if (pending != null && track.id != pending) {
            swipeOffset.snapTo(0f)
            pendingTrackId = null
        }
    }

    // Recover from failed skips (end of queue, network errors, ...).
    LaunchedEffect(pendingTrackId) {
        if (pendingTrackId == null) return@LaunchedEffect
        delay(SWIPE_COMMIT_TIMEOUT_MS)
        if (pendingTrackId != null) {
            pendingTrackId = null
            swipeOffset.animateTo(0f, spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMedium))
        }
    }

    suspend fun commitSwipe(direction: Int) {
        val target = direction * distancePx
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        swipeOffset.animateTo(
            targetValue = target,
            animationSpec = spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMedium),
        )
        pendingTrackId = track.id
        if (direction > 0) viewModel.previous(force = true) else viewModel.next()
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(88.dp)
            .padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .onSizeChanged { infoWidthPx = it.width }
                .pointerInput(track.id, state.previousTrack, state.nextTrack) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val tracker = VelocityTracker()
                        tracker.addPosition(down.uptimeMillis, down.position)
                        var vertical: Boolean? = null
                        var totalX = 0f
                        var maxHorizontal = 0f
                        val completed = drag(down.id) { change ->
                            if (change.isConsumed) return@drag
                            tracker.addPosition(change.uptimeMillis, change.position)
                            val amount = change.positionChange()
                            change.consume()
                            if (vertical == null && (abs(amount.x) > 2f || abs(amount.y) > 2f)) {
                                vertical = abs(amount.y) >= abs(amount.x)
                            }
                            if (vertical == true) {
                                onExpandDrag(amount.y)
                            } else if (vertical == false) {
                                val blocked = (amount.x > 0 && state.previousTrack == null) ||
                                    (amount.x < 0 && state.nextTrack == null)
                                if (!blocked) {
                                    totalX += amount.x
                                    maxHorizontal = max(maxHorizontal, abs(totalX))
                                    scope.launch { swipeOffset.snapTo(swipeOffset.value + amount.x) }
                                }
                            }
                        }
                        when {
                            vertical == true -> onExpandDragEnd()

                            vertical == false -> {
                                val velocityX = tracker.calculateVelocity().x
                                val direction = miniPlayerSwipeDirection(
                                    offsetX = totalX,
                                    velocityX = velocityX,
                                    distanceThresholdPx = thresholdPx,
                                    velocityThreshold = SWIPE_VELOCITY_THRESHOLD,
                                )
                                val hasAdjacent = when {
                                    direction > 0 -> state.previousTrack != null
                                    direction < 0 -> state.nextTrack != null
                                    else -> false
                                }
                                if (direction != 0 && hasAdjacent) {
                                    scope.launch { commitSwipe(direction) }
                                } else {
                                    scope.launch {
                                        swipeOffset.animateTo(
                                            targetValue = 0f,
                                            animationSpec = spring(
                                                dampingRatio = 0.9f,
                                                stiffness = Spring.StiffnessMedium,
                                            ),
                                        )
                                    }
                                }
                            }

                            maxHorizontal < tapSlopPx && completed -> {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                onOpenNowPlaying()
                            }
                        }
                    }
                },
        ) {
            if (state.previousTrack != null && swipeOffset.value > 0f) {
                AdjacentTrackPreview(
                    track = state.previousTrack,
                    translationX = swipeOffset.value - distancePx,
                    alpha = miniPlayerSwipePreviewAlpha(swipeOffset.value, thresholdPx, distancePx),
                )
            }
            if (state.nextTrack != null && swipeOffset.value < 0f) {
                AdjacentTrackPreview(
                    track = state.nextTrack,
                    translationX = swipeOffset.value + distancePx,
                    alpha = miniPlayerSwipePreviewAlpha(swipeOffset.value, thresholdPx, distancePx),
                )
            }
            NowPlayingInfo(
                track = track,
                modifier = Modifier.graphicsLayer {
                    translationX = swipeOffset.value
                    alpha = if (distancePx > 0f) {
                        (1f - abs(swipeOffset.value) / distancePx).coerceIn(0f, 1f)
                    } else {
                        1f
                    }
                },
            )
        }

        PlayPauseButton(state = state, onToggle = viewModel::togglePlayPause)
        IconButton(
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onOpenQueue()
            },
            modifier = Modifier.size(32.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.QueueMusic,
                contentDescription = "Queue",
                modifier = Modifier.size(16.dp),
            )
        }
        MoreMenu(
            state = state,
            onOpenNowPlaying = onOpenNowPlaying,
            viewModel = viewModel,
        )
    }
}

@Composable
private fun NowPlayingInfo(
    track: TrackInfo,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverArt(
            model = inlineCoverModel(track.coverArtData) ?: track.coverArtUrl,
            contentDescription = track.title,
            seed = track.id,
            shape = RoundedCornerShape(6.dp),
            modifier = Modifier.size(56.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = track.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
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
    }
}

@Composable
private fun AdjacentTrackPreview(
    track: TrackInfo,
    translationX: Float,
    alpha: Float,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                this.translationX = translationX
                this.alpha = alpha
            },
    ) {
        NowPlayingInfo(track = track)
    }
}

@Composable
private fun PlayPauseButton(
    state: PlayerUiState,
    onToggle: () -> Unit,
) {
    IconButton(
        onClick = onToggle,
        modifier = Modifier.size(36.dp),
    ) {
        if (state.isBuffering) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
            )
        } else {
            Icon(
                imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (state.isPlaying) "Pause" else "Play",
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun MoreMenu(
    state: PlayerUiState,
    onOpenNowPlaying: () -> Unit,
    viewModel: PlayerViewModel,
) {
    var expanded by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current

    Box {
        IconButton(
            onClick = { expanded = true },
            modifier = Modifier.size(32.dp),
        ) {
            Icon(
                Icons.Filled.MoreHoriz,
                contentDescription = "More options",
                modifier = Modifier.size(16.dp),
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            Row(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = {
                        expanded = false
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.previous()
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        Icons.Filled.SkipPrevious,
                        contentDescription = "Previous track",
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(
                    onClick = {
                        expanded = false
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.togglePlayPause()
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (state.isPlaying) "Pause" else "Play",
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(
                    onClick = {
                        expanded = false
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.next()
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        Icons.Filled.SkipNext,
                        contentDescription = "Next track",
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text(if (state.isShuffled) "Shuffle on" else "Shuffle") },
                leadingIcon = { Icon(Icons.Filled.Shuffle, contentDescription = null) },
                onClick = {
                    expanded = false
                    viewModel.toggleShuffle()
                },
            )
            DropdownMenuItem(
                text = {
                    Text(
                        when (state.repeatMode) {
                            "one" -> "Repeat one"
                            "all" -> "Repeat all"
                            else -> "Repeat off"
                        },
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = if (state.repeatMode == "one") {
                            Icons.Filled.RepeatOne
                        } else {
                            Icons.Filled.Repeat
                        },
                        contentDescription = null,
                    )
                },
                onClick = {
                    expanded = false
                    viewModel.cycleRepeat()
                },
            )
            if (state.cast.isConnected) {
                DropdownMenuItem(
                    text = { Text("Casting to ${state.cast.deviceName ?: "device"}") },
                    leadingIcon = { Icon(Icons.Filled.CastConnected, contentDescription = null) },
                    onClick = {
                        expanded = false
                        viewModel.disconnectCast()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text("Open now playing") },
                leadingIcon = { Icon(Icons.Filled.OpenInFull, contentDescription = null) },
                onClick = {
                    expanded = false
                    onOpenNowPlaying()
                },
            )
        }
    }
}
