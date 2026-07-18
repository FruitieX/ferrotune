package com.ferrotune.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackNotificationLifecycleTest {
    @Test
    fun frameworkForegroundRequestAlwaysWins() {
        assertTrue(
            PlaybackNotificationLifecycle.shouldKeepServiceForeground(
                startInForegroundRequired = true,
                playWhenReady = false,
                mediaItemCount = 0,
            )
        )
    }

    @Test
    fun playbackIntentKeepsLoadedMediaForeground() {
        assertTrue(
            PlaybackNotificationLifecycle.shouldKeepServiceForeground(
                startInForegroundRequired = false,
                playWhenReady = true,
                mediaItemCount = 1,
            )
        )
    }

    @Test
    fun pausedOrEmptyPlayersDoNotRequireForegroundState() {
        assertFalse(
            PlaybackNotificationLifecycle.shouldKeepServiceForeground(
                startInForegroundRequired = false,
                playWhenReady = false,
                mediaItemCount = 1,
            )
        )
        assertFalse(
            PlaybackNotificationLifecycle.shouldKeepServiceForeground(
                startInForegroundRequired = false,
                playWhenReady = true,
                mediaItemCount = 0,
            )
        )
    }
}
