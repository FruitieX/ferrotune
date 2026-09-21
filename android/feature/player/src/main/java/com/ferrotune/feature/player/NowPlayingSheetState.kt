package com.ferrotune.feature.player

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Hoisted state for the now-playing overlay. The sheet is a full-screen
 * surface translated down by [offsetY]: 0 is fully open, [hiddenOffsetPx] is
 * fully closed. Drag gestures update the offset directly so the sheet follows
 * the finger; open/close animations continue from the current offset instead
 * of snapping back.
 */
@Stable
class NowPlayingSheetState(private val scope: CoroutineScope) {
    var hiddenOffsetPx by mutableFloatStateOf(0f)

    var rendered by mutableStateOf(false)
        private set

    var offsetY by mutableFloatStateOf(0f)
        private set

    private var animationJob: Job? = null

    /** 0 = fully open, 1 = fully hidden. */
    val fraction: Float
        get() = if (hiddenOffsetPx <= 0f) 0f else (offsetY / hiddenOffsetPx).coerceIn(0f, 1f)

    fun dragBy(delta: Float) {
        if (hiddenOffsetPx <= 0f) return
        animationJob?.cancel()
        if (!rendered) {
            rendered = true
            offsetY = hiddenOffsetPx
        }
        offsetY = (offsetY + delta).coerceIn(0f, hiddenOffsetPx)
    }

    /** True when a release at the current offset should dismiss the sheet. */
    fun shouldCloseOnRelease(): Boolean = fraction > CLOSE_THRESHOLD

    fun open() {
        if (!rendered) {
            rendered = true
            offsetY = hiddenOffsetPx
        }
        animateTo(0f, spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMedium))
    }

    fun close() {
        animateTo(hiddenOffsetPx, tween(durationMillis = 220)) {
            rendered = false
        }
    }

    fun animateBackOpen() {
        animateTo(0f, tween(durationMillis = 180))
    }

    private fun animateTo(
        target: Float,
        spec: AnimationSpec<Float>,
        onFinished: () -> Unit = {},
    ) {
        animationJob?.cancel()
        animationJob = scope.launch {
            animate(
                initialValue = offsetY,
                targetValue = target,
                animationSpec = spec,
                block = { value, _ -> offsetY = value },
            )
            onFinished()
        }
    }

    companion object {
        const val CLOSE_THRESHOLD = 0.25f
    }
}

@Composable
fun rememberNowPlayingSheetState(): NowPlayingSheetState {
    val scope = rememberCoroutineScope()
    return remember(scope) { NowPlayingSheetState(scope) }
}
