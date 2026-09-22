package com.ferrotune.core.media

/**
 * Typed playback events emitted by [PlaybackService]. Replaces the previous
 * JSON-over-WebView bridge with in-process flows.
 */
sealed interface PlaybackEvent {
    data class StateChanged(val state: PlaybackState) : PlaybackEvent

    data class Progress(
        val positionMs: Long,
        val durationMs: Long,
        val bufferedMs: Long,
    ) : PlaybackEvent

    data class TrackChanged(
        val track: TrackInfo?,
        val queueIndex: Int,
    ) : PlaybackEvent

    data class PlaybackError(
        val message: String,
        val trackId: String?,
        val category: String?,
        val retryable: Boolean,
        val httpStatusCode: Int?,
        val errorCode: Int?,
    ) : PlaybackEvent

    data class QueueStateChanged(
        val totalCount: Int,
        val currentIndex: Int,
        val isShuffled: Boolean,
        val repeatMode: String,
    ) : PlaybackEvent

    data class RepeatModeChanged(val mode: String) : PlaybackEvent

    data class Scrobbled(val trackId: String) : PlaybackEvent

    data class StarToggled(
        val trackId: String,
        val isStarred: Boolean,
    ) : PlaybackEvent

    data class Clipping(
        val peakOverDb: Double,
        val timestampMs: Long,
    ) : PlaybackEvent
}
