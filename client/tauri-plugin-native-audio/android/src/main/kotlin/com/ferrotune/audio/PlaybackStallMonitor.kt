package com.ferrotune.audio

/**
 * Detects silent playback stalls.
 *
 * A "silent stall" is a state where the player intends to play
 * (playWhenReady is true) but neither the playback position nor the buffered
 * position advances for an extended period, and ExoPlayer never raises an
 * error. This happens, for example, when a transcoded HTTP stream stops
 * delivering bytes without closing the connection: ExoPlayer waits
 * indefinitely while the user is left with frozen audio.
 *
 * The monitor is fed periodic samples and recommends a recovery [Action] so
 * the foreground service can re-prepare or skip the current track instead of
 * hanging. It is intentionally a pure state machine (no Android dependencies)
 * so the decision logic can be unit tested.
 */
internal class PlaybackStallMonitor(
    private val stallThresholdMs: Long,
    private val positionEpsilonMs: Long,
    private val maxRecoveries: Int,
) {
    enum class Action {
        /** Playback is progressing (or not intended); do nothing. */
        NONE,

        /** Reload/re-prepare the current track to break the stall. */
        RECOVER,

        /** Recovery did not help; skip to the next track. */
        SKIP,
    }

    private var trackKey: String? = null
    private var lastProgressPositionMs: Long = 0
    private var lastProgressBufferedMs: Long = 0
    private var lastProgressAtMs: Long = 0
    private var recoveriesForCurrentStall = 0

    /** Re-baseline so a later resume starts from a clean slate. */
    fun reset() {
        trackKey = null
        lastProgressPositionMs = 0
        lastProgressBufferedMs = 0
        lastProgressAtMs = 0
        recoveriesForCurrentStall = 0
    }

    /**
     * Evaluate one sample.
     *
     * @param nowMs monotonic clock reading (e.g. SystemClock.elapsedRealtime()).
     * @param currentTrackKey identity of the loaded media item (mediaId/track id).
     * @param intendsToPlay true when the player should be making forward progress
     *   (owner, playWhenReady, ready/buffering, not paused for audio output loss).
     * @param positionMs absolute playback position.
     * @param bufferedPositionMs absolute buffered position (downloaded ahead).
     */
    fun evaluate(
        nowMs: Long,
        currentTrackKey: String?,
        intendsToPlay: Boolean,
        positionMs: Long,
        bufferedPositionMs: Long,
    ): Action {
        if (!intendsToPlay || currentTrackKey == null) {
            // Not trying to play (paused, ended, not owner, ...). Drop the
            // baseline so the next active sample starts fresh.
            trackKey = null
            return Action.NONE
        }

        if (currentTrackKey != trackKey) {
            // New track (or first active sample): establish a fresh baseline.
            baselineTo(currentTrackKey, nowMs, positionMs, bufferedPositionMs)
            return Action.NONE
        }

        // A backwards seek/restart on the same song is also real progress from
        // the watchdog's point of view. The media id does not change when the
        // user presses Previous to restart a song (or seeks backwards), so
        // retaining the old high-water mark would make valid playback below
        // that position look frozen and trigger a false recovery reload.
        val movedBackwards =
            lastProgressPositionMs - positionMs >= positionEpsilonMs
        if (movedBackwards) {
            baselineTo(currentTrackKey, nowMs, positionMs, bufferedPositionMs)
            return Action.NONE
        }

        val advanced =
            positionMs - lastProgressPositionMs >= positionEpsilonMs ||
                bufferedPositionMs - lastProgressBufferedMs >= positionEpsilonMs
        if (advanced) {
            baselineTo(currentTrackKey, nowMs, positionMs, bufferedPositionMs)
            return Action.NONE
        }

        if (nowMs - lastProgressAtMs < stallThresholdMs) {
            return Action.NONE
        }

        // Position and buffer are both frozen past the stall threshold.
        return if (recoveriesForCurrentStall < maxRecoveries) {
            recoveriesForCurrentStall++
            // Give the recovery attempt a fresh window to make progress before
            // we escalate. Keep the position baseline so a reload that lands on
            // the same offset is not mistaken for progress.
            lastProgressAtMs = nowMs
            Action.RECOVER
        } else {
            // Recovery did not help; skip so the user is not stranded.
            recoveriesForCurrentStall = 0
            Action.SKIP
        }
    }

    private fun baselineTo(
        currentTrackKey: String,
        nowMs: Long,
        positionMs: Long,
        bufferedPositionMs: Long,
    ) {
        trackKey = currentTrackKey
        lastProgressPositionMs = positionMs
        lastProgressBufferedMs = bufferedPositionMs
        lastProgressAtMs = nowMs
        recoveriesForCurrentStall = 0
    }
}
