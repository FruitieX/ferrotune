package com.ferrotune.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackNotificationIntentTest {
    @Test
    fun `notification intent requests opening now playing`() {
        assertTrue(PlaybackNotificationIntent.shouldOpenNowPlaying(true))
    }

    @Test
    fun `ordinary launch intent does not request opening now playing`() {
        assertFalse(PlaybackNotificationIntent.shouldOpenNowPlaying(false))
    }
}
