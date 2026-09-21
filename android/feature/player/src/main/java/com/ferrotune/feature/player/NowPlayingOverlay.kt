package com.ferrotune.feature.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Full-screen now-playing surface drawn above the app shell. The app behind
 * stays static; the sheet translates with drag gestures and animates from its
 * current position on release.
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

    LaunchedEffect(open) {
        if (open) {
            state.open()
        } else if (state.rendered) {
            state.close()
        }
    }

    if (!state.rendered) return

    BackHandler(enabled = true) { onOpenChange(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .clipToBounds()
            .onSizeChanged { state.hiddenOffsetPx = it.height.toFloat() },
    ) {
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
            modifier = Modifier
                .fillMaxSize()
                .offset { IntOffset(0, state.offsetY.roundToInt()) }
                .pointerInput(Unit) {
                    var totalX = 0f
                    var vertical: Boolean? = null
                    detectDragGestures(
                        onDragStart = {
                            totalX = 0f
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
                            } else if (abs(totalX) > 120.dp.toPx()) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (totalX > 0) viewModel.previous() else viewModel.next()
                            }
                        },
                        onDragCancel = {
                            state.animateBackOpen()
                        },
                        onDrag = { change, amount ->
                            change.consume()
                            if (vertical == null && (abs(amount.x) > 2f || abs(amount.y) > 2f)) {
                                vertical = abs(amount.y) >= abs(amount.x)
                            }
                            if (vertical == true) {
                                state.dragBy(amount.y)
                            } else {
                                totalX += amount.x
                            }
                        },
                    )
                },
        )
    }
}
