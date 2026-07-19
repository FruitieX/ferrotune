package com.ferrotune.audio

import kotlin.math.roundToLong

internal data class NativeListeningUpdate(
    val generation: Long,
    val songId: String,
    val durationSeconds: Long,
    val finalize: Boolean,
    val skipped: Boolean,
)

/** Pure state machine for native listening-session accounting. */
internal class NativeListeningSessionLifecycle(
    private val minimumDurationMs: Long = 5_000L,
    private val syncIntervalMs: Long = 60_000L,
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

    fun addProgress(elapsedMs: Long): NativeListeningUpdate? {
        if (songId == null) return null
        accumulatedMs += elapsedMs.coerceAtLeast(0)
        return if (
            accumulatedMs >= minimumDurationMs &&
            accumulatedMs - lastScheduledMs >= syncIntervalMs
        ) {
            createUpdate(finalize = false, skipped = false)
        } else {
            null
        }
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
