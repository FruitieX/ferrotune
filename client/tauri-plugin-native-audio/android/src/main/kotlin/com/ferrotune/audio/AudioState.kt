package com.ferrotune.audio

import app.tauri.plugin.JSObject

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
}
