package com.ferrotune.core.media

import androidx.media3.exoplayer.offline.Download

/**
 * Data class representing track information.
 */
data class TrackInfo(
    val id: String,
    val url: String,
    val title: String,
    val artist: String,
    val album: String,
    val coverArtUrl: String?,
    val coverArtData: String? = null,
    val durationMs: Long,
    val replayGainDb: Float? = null
)

/**
 * Enum representing playback status.
 */
enum class PlaybackStatus {
    IDLE,
    BUFFERING,
    PLAYING,
    PAUSED,
    ENDED,
    ERROR;

    fun toJsonValue(): String = when (this) {
        IDLE -> "Idle"
        BUFFERING -> "Buffering"
        PLAYING -> "Playing"
        PAUSED -> "Paused"
        ENDED -> "Ended"
        ERROR -> "Error"
    }
}

/**
 * Data class representing the full playback state.
 */
data class PlaybackState(
    val status: PlaybackStatus = PlaybackStatus.IDLE,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val volume: Float = 1.0f,
    val muted: Boolean = false,
    val track: TrackInfo? = null,
    val queueIndex: Int = -1,
    val queueLength: Int = 0
)

/**
 * Media3 download state, projected to a stable client-facing value.
 *
 * Mirrors androidx.media3.exoplayer.offline.Download.STATE_* constants
 * but simplified to the states the UI cares about.
 */
enum class DownloadStatus(val jsValue: String) {
    QUEUED("queued"),
    DOWNLOADING("downloading"),
    COMPLETED("completed"),
    FAILED("failed"),
    REMOVING("removing"),
    PAUSED("paused");

    companion object {
        fun fromMedia3State(state: Int, failed: Boolean, manualPause: Boolean): DownloadStatus {
            return when {
                failed -> FAILED
                manualPause -> PAUSED
                state == Download.STATE_COMPLETED -> COMPLETED
                state == Download.STATE_DOWNLOADING -> DOWNLOADING
                state == Download.STATE_QUEUED -> QUEUED
                state == Download.STATE_REMOVING -> REMOVING
                else -> QUEUED
            }
        }
    }
}

/**
 * Snapshot of a single download's state, emitted as part of
 * [DownloadStateEventPayload].
 */
data class DownloadInfo(
    val contentId: String,
    val songId: String,
    val kind: String, // "audio" | "cover"
    val status: String,
    val percent: Float,
    val bytesDownloaded: Long,
    val bytesTotal: Long,
    val failureReason: String? = null,
)

/**
 * Top-level payload of a download state event. Carries all affected downloads
 * each emission so the UI can refresh atomically.
 */
data class DownloadStateEventPayload(
    val downloads: List<DownloadInfo>,
    val paused: Boolean,
    val notMetRequirements: Int,
)
