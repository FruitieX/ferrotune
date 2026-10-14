package com.ferrotune.core.media

import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadAheadLoadControlTest {
    @Test
    fun `before settling only the playing track and the next one load`() {
        assertFalse(ReadAheadLoadControl.isBeyondNextTrack(loadingIndex = 4, playingIndex = 4))
        assertFalse(ReadAheadLoadControl.isBeyondNextTrack(loadingIndex = 5, playingIndex = 4))
        assertTrue(ReadAheadLoadControl.isBeyondNextTrack(loadingIndex = 6, playingIndex = 4))
        // Repeat-all wraps to the start of the queue: that's the next track.
        assertFalse(ReadAheadLoadControl.isBeyondNextTrack(loadingIndex = 0, playingIndex = 9))
    }

    @Test
    fun `a track that plays for the settle time releases the full buffer`() {
        val control = ReadAheadLoadControl(DefaultLoadControl())
        control.unsettle(playingIndex = 3)
        control.onPlaybackProgress(playingIndex = 3, positionMs = ReadAheadLoadControl.SETTLE_PLAYBACK_MS - 1)
        assertFalse(control.settled)

        control.onPlaybackProgress(playingIndex = 3, positionMs = ReadAheadLoadControl.SETTLE_PLAYBACK_MS)
        assertTrue(control.settled)

        control.unsettle(playingIndex = 4)
        assertFalse(control.settled)
    }

    @Test
    fun `every load control call ExoPlayer makes reaches the delegate`() {
        // The interface's Java defaults throw; Kotlin delegation doesn't cover them.
        val control = ReadAheadLoadControl(DefaultLoadControl())
        val player = PlayerId.UNSET
        control.onPrepared(player)
        control.getAllocator(player)
        control.getBackBufferDurationUs(player)
        control.retainBackBufferFromKeyframe(player)
        control.onStopped(player)
        control.onReleased(player)
    }
}
