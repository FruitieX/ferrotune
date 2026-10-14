package com.ferrotune.core.media

/** Invalidates callbacks from SSE calls that have already been replaced. */
internal class SseConnectionGeneration {
    @Volatile
    private var current: Long = 0

    @Synchronized
    fun advance(): Long {
        current += 1
        return current
    }

    fun isCurrent(generation: Long): Boolean = generation == current
}

/**
 * Whether to hold the session event stream open. It lets other clients
 * control this app and keeps the UI's view of the session current, but the
 * server's keep-alives wake the radio every 15 seconds for as long as it is
 * open, even while Android has frozen the app. So it is held only while
 * playback is intended or the app is on screen.
 */
internal fun shouldHoldSessionSse(
    hasSessionConfig: Boolean,
    appVisible: Boolean,
    playbackIntended: Boolean,
): Boolean = hasSessionConfig && (appVisible || playbackIntended)
