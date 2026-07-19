package com.ferrotune.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewPlaybackEventPolicyTest {
    @Test
    fun foregroundForwardsPlaybackEvents() {
        assertTrue(
            WebViewPlaybackEventPolicy.shouldForward(
                isForeground = true,
                event = AudioEvents.TRACK_CHANGE,
            )
        )
        assertTrue(
            WebViewPlaybackEventPolicy.shouldForward(
                isForeground = true,
                event = AudioEvents.STATE_CHANGE,
            )
        )
    }

    @Test
    fun backgroundDropsStateThatWillBeReplacedByResumeSnapshot() {
        listOf(
            AudioEvents.STATE_CHANGE,
            AudioEvents.PROGRESS,
            AudioEvents.TRACK_CHANGE,
            AudioEvents.QUEUE_STATE_CHANGED,
            AudioEvents.SCROBBLE,
            AudioEvents.CLIPPING,
        ).forEach { event ->
            assertFalse(
                WebViewPlaybackEventPolicy.shouldForward(
                    isForeground = false,
                    event = event,
                )
            )
        }
    }

    @Test
    fun backgroundStillForwardsUserCommandsAndErrors() {
        assertTrue(
            WebViewPlaybackEventPolicy.shouldForward(
                isForeground = false,
                event = AudioEvents.TOGGLE_STAR,
            )
        )
        assertTrue(
            WebViewPlaybackEventPolicy.shouldForward(
                isForeground = false,
                event = AudioEvents.ERROR,
            )
        )
    }
}
