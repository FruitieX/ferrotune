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
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Animation driver for [NowPlayingSheetState]. The default implementation uses
 * Compose's frame-clock animations; tests inject a synchronous implementation
 * because the JVM test dispatcher has no `MonotonicFrameClock`.
 */
fun interface SheetAnimator {
    suspend fun animate(
        initialValue: Float,
        targetValue: Float,
        animationSpec: AnimationSpec<Float>,
        onValue: (Float) -> Unit,
    )
}

internal val DefaultSheetAnimator = SheetAnimator { initialValue, targetValue, animationSpec, onValue ->
    animate(
        initialValue = initialValue,
        targetValue = targetValue,
        animationSpec = animationSpec,
        block = { value, _ -> onValue(value) },
    )
}

/**
 * Hoisted state for the now-playing overlay. The sheet is a full-screen
 * surface translated down by [offsetY]: 0 is fully open, [hiddenOffsetPx] is
 * fully closed. Drag gestures update the offset directly so the sheet follows
 * the finger; open/close animations continue from the current offset instead
 * of snapping back.
 */
@Stable
class NowPlayingSheetState internal constructor(
    private val scope: CoroutineScope,
    private val animator: SheetAnimator,
) {
    constructor(scope: CoroutineScope) : this(scope, DefaultSheetAnimator)
    var hiddenOffsetPx by mutableFloatStateOf(0f)

    /** Pixels per dp, for the web's dp-based swipe thresholds. */
    var density = 1f

    var rendered by mutableStateOf(false)
        private set

    var offsetY by mutableFloatStateOf(0f)
        private set

    /** Horizontal artwork offset in px; 0 at rest. */
    var artOffsetX by mutableFloatStateOf(0f)
        private set

    var artDragging by mutableStateOf(false)
        private set

    /** Distance between adjacent artwork slots, measured by the artwork box. */
    var artDistancePx by mutableFloatStateOf(0f)

    private var animationJob: Job? = null
    private var artAnimationJob: Job? = null
    private var artCommitTimeoutJob: Job? = null
    private var pendingCommitTrackId: String? = null

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

    /**
     * Positions the sheet from the system back-gesture progress
     * (0 = fully open, 1 = fully hidden).
     */
    fun dragToFraction(progress: Float) {
        if (hiddenOffsetPx <= 0f) return
        animationJob?.cancel()
        if (!rendered) rendered = true
        offsetY = progress.coerceIn(0f, 1f) * hiddenOffsetPx
    }

    /**
     * Web fullscreen player: dismiss after a 100dp pull down, or a quick
     * downward flick once past 40dp. [velocityY] is in px/s, down positive.
     */
    fun shouldCloseOnRelease(velocityY: Float = 0f): Boolean =
        offsetY > CLOSE_DISTANCE_DP * density ||
            (offsetY > CLOSE_FLICK_MIN_DP * density && velocityY > CLOSE_VELOCITY_DP * density)

    /**
     * Web swipeable footer: open after a 50dp pull up, or any upward flick; a
     * downward flick at release cancels. [velocityY] is in px/s, down positive.
     */
    fun shouldOpenOnRelease(velocityY: Float = 0f): Boolean {
        val pulled = hiddenOffsetPx - offsetY
        if (velocityY > OPEN_VELOCITY_DP * density) return false
        return pulled > OPEN_DISTANCE_DP * density || (pulled > 0f && velocityY < -OPEN_VELOCITY_DP * density)
    }

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

    fun dragArtBy(delta: Float) {
        artAnimationJob?.cancel()
        artDragging = true
        artOffsetX += delta
    }

    /** Springs the artwork back to its resting position. */
    fun settleArt() {
        artDragging = false
        artAnimationJob?.cancel()
        artAnimationJob = scope.launch {
            animator.animate(
                initialValue = artOffsetX,
                targetValue = 0f,
                animationSpec = spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMedium),
                onValue = { artOffsetX = it },
            )
        }
    }

    /**
     * Slides the artwork out in [direction] (1 = previous, -1 = next), commits
     * the track change, then waits for the new track before recentering the
     * artwork. Waiting avoids flashing the outgoing cover between the swipe
     * animation and the incoming track's artwork.
     */
    fun commitArtSwipe(direction: Int, fromTrackId: String?, onCommit: () -> Unit) {
        artDragging = false
        artAnimationJob?.cancel()
        artCommitTimeoutJob?.cancel()
        val distance = artDistancePx.takeIf { it > 0f } ?: 1f
        artAnimationJob = scope.launch {
            animator.animate(
                initialValue = artOffsetX,
                targetValue = direction * distance,
                animationSpec = tween(durationMillis = 140),
                onValue = { artOffsetX = it },
            )
            pendingCommitTrackId = fromTrackId
            onCommit()
            artCommitTimeoutJob = scope.launch {
                delay(ART_COMMIT_TIMEOUT_MS)
                if (pendingCommitTrackId != null) {
                    pendingCommitTrackId = null
                    artOffsetX = 0f
                }
            }
        }
    }

    /**
     * Recenters the artwork once the track that [commitArtSwipe] was waiting
     * for arrives. No-op while no swipe commit is pending.
     */
    fun onTrackChanged(trackId: String?) {
        val pending = pendingCommitTrackId ?: return
        if (trackId == pending) return
        pendingCommitTrackId = null
        artCommitTimeoutJob?.cancel()
        artCommitTimeoutJob = null
        artOffsetX = 0f
    }

    private fun animateTo(
        target: Float,
        spec: AnimationSpec<Float>,
        onFinished: () -> Unit = {},
    ) {
        animationJob?.cancel()
        animationJob = scope.launch {
            animator.animate(
                initialValue = offsetY,
                targetValue = target,
                animationSpec = spec,
                onValue = { offsetY = it },
            )
            onFinished()
        }
    }

    companion object {
        // The web's thresholds (CSS px ≈ dp): fullscreen-player.tsx and swipeable-footer.tsx.
        const val OPEN_DISTANCE_DP = 50f
        const val OPEN_VELOCITY_DP = 300f
        const val CLOSE_DISTANCE_DP = 100f
        const val CLOSE_FLICK_MIN_DP = 40f
        const val CLOSE_VELOCITY_DP = 500f
        const val ART_COMMIT_TIMEOUT_MS = 3000L
    }
}

@Composable
fun rememberNowPlayingSheetState(): NowPlayingSheetState {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current.density
    return remember(scope) { NowPlayingSheetState(scope) }.also { it.density = density }
}
