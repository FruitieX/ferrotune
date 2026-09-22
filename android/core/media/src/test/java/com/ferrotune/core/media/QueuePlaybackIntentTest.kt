package com.ferrotune.core.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueuePlaybackIntentTest {
    @Test
    fun explicitPlayWinsWhenAudioFocusPausedThePlayer() {
        assertTrue(
            QueuePlaybackIntent.shouldContinuePlayback(
                explicitPlayPending = true,
                playWhenReady = false,
                isPlaying = false,
            )
        )
    }

    @Test
    fun queueRefreshDoesNotCreatePlaybackAfterARealPause() {
        assertFalse(
            QueuePlaybackIntent.shouldContinuePlayback(
                explicitPlayPending = false,
                playWhenReady = false,
                isPlaying = false,
            )
        )
    }
}
