package com.ferrotune.feature.player

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException

private val SKIP_THRESHOLD = 80.dp

/**
 * Full-screen now-playing surface drawn above the app shell. The app behind
 * stays static; the sheet translates with drag gestures (including the system
 * predictive back gesture) and animates from its current position on release.
 */
@Composable
fun NowPlayingOverlay(
    open: Boolean,
    state: NowPlayingSheetState,
    onOpenChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val haptics = LocalHapticFeedback.current
    val playerState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(open) {
        if (open) {
            state.open()
        } else if (state.rendered) {
            state.close()
        }
    }

    // Wait for the committed track before recentering the artwork so the
    // outgoing cover never flashes back into the center.
    LaunchedEffect(playerState.track?.id) {
        state.onTrackChanged(playerState.track?.id)
    }

    PredictiveBackHandler(enabled = state.rendered) { progress ->
        try {
            progress.collect { event -> state.dragToFraction(event.progress) }
            onOpenChange(false)
        } catch (cancelled: CancellationException) {
            state.animateBackOpen()
            throw cancelled
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .clipToBounds()
            .onSizeChanged { state.hiddenOffsetPx = it.height.toFloat() },
    ) {
        if (!state.rendered) return@Box

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.45f * (1f - state.fraction)))
                .pointerInput(Unit) {
                    detectTapGestures { onOpenChange(false) }
                },
        )

        NowPlayingScreen(
            onBack = { onOpenChange(false) },
            sheetState = state,
            modifier = Modifier
                .fillMaxSize()
                .offset { IntOffset(0, state.offsetY.roundToInt()) }
                .pointerInput(Unit) {
                    var vertical: Boolean? = null
                    val skipThresholdPx = SKIP_THRESHOLD.toPx()
                    detectDragGestures(
                        onDragStart = {
                            vertical = null
                        },
                        onDragEnd = {
                            if (vertical == true) {
                                if (state.shouldCloseOnRelease()) {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onOpenChange(false)
                                } else {
                                    state.animateBackOpen()
                                }
                            } else {
                                val offsetX = state.artOffsetX
                                when {
                                    offsetX > skipThresholdPx &&
                                        playerState.previousTrack != null -> {
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        state.commitArtSwipe(
                                            direction = 1,
                                            fromTrackId = playerState.track?.id,
                                        ) {
                                            viewModel.previous(force = true)
                                        }
                                    }

                                    offsetX < -skipThresholdPx &&
                                        playerState.nextTrack != null -> {
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        state.commitArtSwipe(
                                            direction = -1,
                                            fromTrackId = playerState.track?.id,
                                        ) {
                                            viewModel.next()
                                        }
                                    }

                                    else -> state.settleArt()
                                }
                            }
                        },
                        onDragCancel = {
                            if (vertical == true) state.animateBackOpen() else state.settleArt()
                        },
                        onDrag = { change, amount ->
                            change.consume()
                            if (vertical == null && (abs(amount.x) > 2f || abs(amount.y) > 2f)) {
                                vertical = abs(amount.y) >= abs(amount.x)
                            }
                            if (vertical == true) {
                                state.dragBy(amount.y)
                            } else if (vertical == false) {
                                val blocked = (amount.x > 0 && playerState.previousTrack == null) ||
                                    (amount.x < 0 && playerState.nextTrack == null)
                                if (!blocked) state.dragArtBy(amount.x)
                            }
                        },
                    )
                },
        )
    }
}
