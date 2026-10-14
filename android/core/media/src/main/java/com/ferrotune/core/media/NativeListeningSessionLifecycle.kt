package com.ferrotune.core.media

import kotlin.math.roundToLong

internal data class NativeListeningUpdate(
    val generation: Long,
    val songId: String,
    val durationSeconds: Long,
    val finalize: Boolean,
    val skipped: Boolean,
)

/**
 * Pure state machine for native listening-session accounting. Updates come
 * only at pauses and track changes, where the app reports to the server
 * anyway: a periodic update would wake the radio on its own every minute.
 * Listening time of a track the app dies in the middle of is lost.
 */
internal class NativeListeningSessionLifecycle(
    private val minimumDurationMs: Long = 5_000L,
) {
    private var nextGeneration = 0L
    private var generation = 0L
    private var songId: String? = null
    private var accumulatedMs = 0L
    private var lastScheduledMs = 0L

    fun changeTrack(nextSongId: String?): NativeListeningUpdate? {
        if (songId == nextSongId) return null

        val finalUpdate = finish()
        if (nextSongId != null) {
            nextGeneration += 1
            generation = nextGeneration
            songId = nextSongId
            accumulatedMs = 0
            lastScheduledMs = 0
        }
        return finalUpdate
    }

    fun addProgress(elapsedMs: Long) {
        if (songId == null) return
        accumulatedMs += elapsedMs.coerceAtLeast(0)
    }

    fun snapshot(): NativeListeningUpdate? {
        if (accumulatedMs < minimumDurationMs || accumulatedMs <= lastScheduledMs) {
            return null
        }
        return createUpdate(finalize = false, skipped = false)
    }

    fun finish(skipped: Boolean = false): NativeListeningUpdate? {
        val update = if (accumulatedMs >= minimumDurationMs) {
            createUpdate(finalize = true, skipped = skipped)
        } else {
            null
        }
        songId = null
        accumulatedMs = 0
        lastScheduledMs = 0
        return update
    }

    private fun createUpdate(finalize: Boolean, skipped: Boolean): NativeListeningUpdate {
        val currentSongId = checkNotNull(songId)
        lastScheduledMs = accumulatedMs
        return NativeListeningUpdate(
            generation = generation,
            songId = currentSongId,
            durationSeconds = (accumulatedMs / 1000.0).roundToLong().coerceAtLeast(1L),
            finalize = finalize,
            skipped = skipped,
        )
    }
}
