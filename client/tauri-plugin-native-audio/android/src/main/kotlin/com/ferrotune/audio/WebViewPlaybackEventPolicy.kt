package com.ferrotune.audio

/**
 * Controls which native playback events may cross into a suspended WebView.
 *
 * Playback continues autonomously in [PlaybackService] while the Activity is
 * backgrounded. State-like events are snapshots, not commands, so queuing
 * every intermediate transition only replays stale history when the WebView
 * wakes. The plugin emits one current playback snapshot on resume instead.
 */
internal object WebViewPlaybackEventPolicy {
    private val snapshotEvents = setOf(
        AudioEvents.STATE_CHANGE,
        AudioEvents.PROGRESS,
        AudioEvents.TRACK_CHANGE,
        AudioEvents.QUEUE_STATE_CHANGED,
        AudioEvents.SCROBBLE,
        AudioEvents.CLIPPING,
    )

    fun shouldForward(isForeground: Boolean, event: String): Boolean =
        isForeground || event !in snapshotEvents
}
