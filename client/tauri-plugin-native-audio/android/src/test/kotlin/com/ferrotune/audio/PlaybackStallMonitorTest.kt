package com.ferrotune.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackStallMonitorTest {
    private fun monitor() = PlaybackStallMonitor(
        stallThresholdMs = 15_000,
        positionEpsilonMs = 500,
        maxRecoveries = 2,
    )

    @Test
    fun reportsNoneWhilePositionAdvances() {
        val monitor = monitor()
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 0, bufferedPositionMs = 0),
        )
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(20_000, "track-a", intendsToPlay = true, positionMs = 20_000, bufferedPositionMs = 30_000),
        )
    }

    @Test
    fun recoversWhenPositionAndBufferFreezePastThreshold() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300)
        // Still within threshold: no action yet.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(10_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        // Frozen past threshold: recover.
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(16_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
    }

    @Test
    fun doesNotStallWhenBufferKeepsAdvancing() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_000)
        // Playback position pinned (rebuffering) but data is still arriving:
        // buffer advancing means we are NOT stalled.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(16_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 60_000),
        )
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(40_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 120_000),
        )
    }

    @Test
    fun skipsAfterRepeatedFailedRecoveries() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300)
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(16_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(32_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        assertEquals(
            PlaybackStallMonitor.Action.SKIP,
            monitor.evaluate(48_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
    }

    @Test
    fun recoveryCounterResetsAfterProgress() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300)
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(16_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        // Recovery worked: position advanced.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(18_000, "track-a", intendsToPlay = true, positionMs = 7_000, bufferedPositionMs = 8_000),
        )
        // A later, unrelated stall starts the recovery budget over.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(30_000, "track-a", intendsToPlay = true, positionMs = 7_000, bufferedPositionMs = 8_000),
        )
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(34_000, "track-a", intendsToPlay = true, positionMs = 7_000, bufferedPositionMs = 8_000),
        )
    }

    @Test
    fun rebaselinesWhenTrackChanges() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300)
        // New track at low position must not be seen as a stall on the old one.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(16_000, "track-b", intendsToPlay = true, positionMs = 0, bufferedPositionMs = 0),
        )
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(32_000, "track-b", intendsToPlay = true, positionMs = 0, bufferedPositionMs = 0),
        )
    }

    @Test
    fun rebaselinesWhenSameTrackSeeksBackwards() {
        val monitor = monitor()
        monitor.evaluate(
            0,
            "track-a",
            intendsToPlay = true,
            positionMs = 30_000,
            bufferedPositionMs = 60_000,
        )

        // This mirrors Previous restarting the currently playing song. The
        // media id stays the same, but the position and buffer return to zero.
        // Even though the old baseline is past the stall threshold, this is a
        // new valid playback baseline rather than a silent stall.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(
                16_000,
                "track-a",
                intendsToPlay = true,
                positionMs = 0,
                bufferedPositionMs = 0,
            ),
        )
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(
                20_000,
                "track-a",
                intendsToPlay = true,
                positionMs = 4_000,
                bufferedPositionMs = 8_000,
            ),
        )

        // A genuine freeze after the backwards seek is still recovered from
        // the new baseline.
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(
                36_000,
                "track-a",
                intendsToPlay = true,
                positionMs = 4_000,
                bufferedPositionMs = 8_000,
            ),
        )
    }

    @Test
    fun pausedPlaybackNeverStalls() {
        val monitor = monitor()
        monitor.evaluate(0, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300)
        // User paused: frozen position is expected, not a stall.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(60_000, "track-a", intendsToPlay = false, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        // Resuming re-baselines instead of immediately firing.
        assertEquals(
            PlaybackStallMonitor.Action.NONE,
            monitor.evaluate(61_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
        assertEquals(
            PlaybackStallMonitor.Action.RECOVER,
            monitor.evaluate(77_000, "track-a", intendsToPlay = true, positionMs = 5_000, bufferedPositionMs = 5_300),
        )
    }
}
