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

    /** True when a release at the current offset should dismiss the sheet. */
    fun shouldCloseOnRelease(): Boolean = fraction > CLOSE_THRESHOLD

    /** True when a release after an expand drag should open the sheet. */
    fun shouldOpenOnRelease(): Boolean = fraction < OPEN_THRESHOLD

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
        const val CLOSE_THRESHOLD = 0.25f
        const val OPEN_THRESHOLD = 0.8f
        const val ART_COMMIT_TIMEOUT_MS = 3000L
    }
}

@Composable
fun rememberNowPlayingSheetState(): NowPlayingSheetState {
    val scope = rememberCoroutineScope()
    return remember(scope) { NowPlayingSheetState(scope) }
}
