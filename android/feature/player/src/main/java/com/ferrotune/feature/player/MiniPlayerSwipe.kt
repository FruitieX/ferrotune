package com.ferrotune.feature.player

import kotlin.math.abs

/**
 * Release decision for the mini player's horizontal swipe, matching the web
 * `SwipeableNowPlaying`: 1 = previous, -1 = next, 0 = settle back. A swipe
 * commits when the drag passes [distanceThresholdPx] or the release velocity
 * passes [velocityThreshold] in either direction.
 */
internal fun miniPlayerSwipeDirection(
    offsetX: Float,
    velocityX: Float,
    distanceThresholdPx: Float,
    velocityThreshold: Float,
): Int = when {
    offsetX < -distanceThresholdPx || velocityX < -velocityThreshold -> -1
    offsetX > distanceThresholdPx || velocityX > velocityThreshold -> 1
    else -> 0
}

/**
 * Opacity ramp for the adjacent-track preview while dragging: 0 at rest,
 * 0.5 once the swipe threshold is reached, 1 at the full commit distance
 * (web `prevPreviewOpacity` / `nextPreviewOpacity`).
 */
internal fun miniPlayerSwipePreviewAlpha(
    offsetX: Float,
    distanceThresholdPx: Float,
    distancePx: Float,
): Float {
    val magnitude = abs(offsetX)
    if (magnitude <= 0f) return 0f
    if (magnitude <= distanceThresholdPx) {
        return if (distanceThresholdPx <= 0f) 1f else 0.5f * (magnitude / distanceThresholdPx)
    }
    val span = distancePx - distanceThresholdPx
    return if (span <= 0f) 1f else (0.5f + 0.5f * ((magnitude - distanceThresholdPx) / span)).coerceAtMost(1f)
}
