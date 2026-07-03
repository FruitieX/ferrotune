package com.ferrotune.audio

import app.tauri.plugin.JSObject
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
) {
    fun toJSObject(): JSObject {
        return JSObject().apply {
            put("id", id)
            put("url", url)
            put("title", title)
            put("artist", artist)
            put("album", album)
            if (coverArtUrl != null) {
                put("coverArtUrl", coverArtUrl)
            }
            put("durationMs", durationMs)
            if (replayGainDb != null) {
                put("replayGainDb", replayGainDb.toDouble())
            }
        }
    }
}

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
) {
    fun toJSObject(): JSObject {
        return JSObject().apply {
            put("status", status.toJsonValue())
            put("positionMs", positionMs)
            put("durationMs", durationMs)
            put("volume", volume.toDouble())
            put("muted", muted)
            if (track != null) {
                put("track", track.toJSObject())
            }
            put("queueIndex", queueIndex)
            put("queueLength", queueLength)
        }
    }
}

/**
 * Event names matching the Rust side.
 */
object AudioEvents {
    const val STATE_CHANGE = "state-change"
    const val PROGRESS = "progress"
    const val ERROR = "error"
    const val TRACK_CHANGE = "track-change"
    const val SKIP_PREVIOUS = "skip-previous"
    const val SKIP_NEXT = "skip-next"
    const val TOGGLE_STAR = "toggle-star"
    const val SHUFFLE_MODE_CHANGED = "shuffle-mode-changed"
    const val REPEAT_MODE_CHANGED = "repeat-mode-changed"
    const val QUEUE_STATE_CHANGED = "queue-state-changed"
    const val SCROBBLE = "scrobble"
    const val CLIPPING = "clipping"
    const val DOWNLOAD_STATE_CHANGED = "download-state-changed"
}

/**
 * Media3 download state, projected to a JS-friendly value.
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
 * Snapshot of a single download's state, sent to JS as part of
 * [AudioEvents.DOWNLOAD_STATE_CHANGED].
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
) {
    fun toJSObject(): JSObject {
        return JSObject().apply {
            put("contentId", contentId)
            put("songId", songId)
            put("kind", kind)
            put("status", status)
            put("percent", percent.toDouble())
            put("bytesDownloaded", bytesDownloaded)
            put("bytesTotal", bytesTotal)
            if (failureReason != null) put("failureReason", failureReason)
        }
    }
}

/**
 * Top-level payload of a download-state-changed event.
 * Carries all affected downloads each emission so JS can refresh atomically.
 */
data class DownloadStateEventPayload(
    val downloads: List<DownloadInfo>,
    val paused: Boolean,
    val notMetRequirements: Int,
) {
    fun toJSObject(): JSObject {
        return JSObject().apply {
            val arr = app.tauri.plugin.JSArray()
            downloads.forEach { arr.put(it.toJSObject()) }
            put("downloads", arr)
            put("paused", paused)
            put("notMetRequirements", notMetRequirements)
        }
    }
}
