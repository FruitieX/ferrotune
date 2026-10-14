package com.ferrotune.core.media

/**
 * Delay before retrying a failed transcoded-stream load, or null to give up.
 *
 * Client errors (4xx other than 408/429) won't succeed on a retry. Anything
 * else (no network, DNS, resets, 5xx) is retried quickly [quickRetries] times,
 * then with a doubling delay up to [maxSlowDelayMs], for about half an hour.
 * Giving up after the quick retries left a hole in an upcoming track after a
 * brief network loss (say a cell handover while walking), heard as a pause
 * only when playback reached it, long after the network was back. The slow
 * retries stay rare because a paused player keeps loading ahead too.
 *
 * The playing track still falls back to a time-offset reload when its buffer
 * runs dry: ExoPlayer reports the load error once more than
 * `minimumLoadableRetryCount` attempts failed, while it keeps retrying.
 */
internal fun transcodedStreamRetryDelayMs(
    errorCount: Int,
    httpStatus: Int?,
    quickRetries: Int = 10,
    quickDelayStepMs: Long = 1_000L,
    maxQuickDelayMs: Long = 5_000L,
    firstSlowDelayMs: Long = 30_000L,
    maxSlowDelayMs: Long = 300_000L,
    slowRetries: Int = 8,
): Long? {
    if (httpStatus != null && httpStatus in 400..499 && httpStatus != 408 && httpStatus != 429) {
        return null
    }
    if (errorCount <= quickRetries) {
        return minOf(quickDelayStepMs * errorCount, maxQuickDelayMs)
    }
    val slowAttempt = errorCount - quickRetries
    if (slowAttempt > slowRetries) return null
    return minOf(firstSlowDelayMs shl (slowAttempt - 1).coerceAtMost(20), maxSlowDelayMs)
}
