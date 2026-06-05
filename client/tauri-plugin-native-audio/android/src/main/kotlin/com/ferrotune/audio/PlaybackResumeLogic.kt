package com.ferrotune.audio

import androidx.media3.common.Player

/**
 * Pure helpers for deciding how an explicit play/resume request should be
 * applied to ExoPlayer.
 *
 * Background: [Player.play] only flips `playWhenReady` to true. It cannot
 * resume a player that has finished its loaded window ([Player.STATE_ENDED]) or
 * one that has been reset by an error or stop ([Player.STATE_IDLE]). Rapidly
 * switching tracks via the queue can leave the player in one of those states
 * while the UI still shows a paused (play) icon — so pressing play appears to do
 * nothing. The seek- and skip-based code paths already re-prepare in these
 * states; this logic lets the explicit play path do the same.
 *
 * Kept as a dependency-free object so the decision can be unit tested.
 */
internal object PlaybackResumeLogic {
    /**
     * Whether an explicit play request needs to re-prepare the player rather
     * than simply set `playWhenReady`. True for the finished/idle states where
     * [Player.play] is a no-op.
     */
    fun requiresReprepareToResume(playbackState: Int): Boolean =
        playbackState == Player.STATE_ENDED || playbackState == Player.STATE_IDLE

    /**
     * When re-preparing, whether the current item's position must first be reset
     * to its start. After [Player.STATE_ENDED] the current item is parked at its
     * end, so `prepare()` alone would immediately re-end. [Player.STATE_IDLE]
     * keeps its position (e.g. an error mid-track) so playback can resume in
     * place.
     */
    fun shouldResetToItemStartBeforeReprepare(playbackState: Int): Boolean =
        playbackState == Player.STATE_ENDED
}
