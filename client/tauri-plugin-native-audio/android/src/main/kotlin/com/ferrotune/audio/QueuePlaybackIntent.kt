package com.ferrotune.audio

/**
 * Decides whether an SSE queue refresh should keep playback running.
 *
 * A queue start is delivered through two paths: the explicit native queue
 * invalidation and the server's QueueChanged event. If audio focus was lost,
 * ExoPlayer reports playWhenReady=false while the explicit invalidation is
 * still in flight. The explicit request must win over that paused snapshot.
 */
internal object QueuePlaybackIntent {
    fun shouldContinuePlayback(
        explicitPlayPending: Boolean,
        playWhenReady: Boolean,
        isPlaying: Boolean,
    ): Boolean = explicitPlayPending || playWhenReady || isPlaying
}
