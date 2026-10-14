package com.ferrotune.core.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeListeningSessionLifecycleTest {
    @Test
    fun playbackIsReportedOnceWhenTheTrackChanges() {
        val lifecycle = NativeListeningSessionLifecycle()

        assertNull(lifecycle.changeTrack("song-a"))
        // No periodic updates: each would wake the radio on its own.
        lifecycle.addProgress(185_000)
        lifecycle.addProgress(1_000)

        val final = lifecycle.changeTrack("song-b")
        assertEquals("song-a", final?.songId)
        assertEquals(186L, final?.durationSeconds)
        assertTrue(final?.finalize ?: false)
    }

    @Test
    fun pauseSnapshotsAndResumeKeepsTheSameGeneration() {
        val lifecycle = NativeListeningSessionLifecycle()
        lifecycle.changeTrack("song-a")
        lifecycle.addProgress(12_400)

        val paused = lifecycle.snapshot()
        assertEquals(12L, paused?.durationSeconds)
        assertFalse(paused?.finalize ?: true)
        assertNull(lifecycle.snapshot())

        lifecycle.addProgress(7_600)
        val final = lifecycle.finish()
        assertEquals(paused?.generation, final?.generation)
        assertEquals(20L, final?.durationSeconds)
        assertTrue(final?.finalize ?: false)
    }

    @Test
    fun shortPlaybackDoesNotCreateAListeningSession() {
        val lifecycle = NativeListeningSessionLifecycle()
        lifecycle.changeTrack("song-a")
        lifecycle.addProgress(4_999)

        assertNull(lifecycle.finish(skipped = true))
    }
}
