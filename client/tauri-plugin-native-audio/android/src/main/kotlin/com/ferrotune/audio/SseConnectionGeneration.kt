package com.ferrotune.audio

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

/** Keep an owning service remotely controllable even before media is loaded. */
internal fun shouldReconnectSessionSse(
    nativeOwnsSession: Boolean,
    hasSessionConfig: Boolean,
): Boolean = nativeOwnsSession && hasSessionConfig
