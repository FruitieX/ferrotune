package com.ferrotune.core.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SseConnectionGenerationTest {
    @Test
    fun replacingConnectionInvalidatesOldCallbacks() {
        val generations = SseConnectionGeneration()
        val first = generations.advance()
        assertTrue(generations.isCurrent(first))

        val replacement = generations.advance()
        assertFalse(generations.isCurrent(first))
        assertTrue(generations.isCurrent(replacement))

        generations.advance()
        assertFalse(generations.isCurrent(replacement))
    }

    @Test
    fun streamIsHeldWhilePlayingOrOnScreen() {
        assertTrue(shouldHoldSessionSse(hasSessionConfig = true, appVisible = false, playbackIntended = true))
        assertTrue(shouldHoldSessionSse(hasSessionConfig = true, appVisible = true, playbackIntended = false))
    }

    @Test
    fun idleBackgroundAppReleasesTheStream() {
        assertFalse(shouldHoldSessionSse(hasSessionConfig = true, appVisible = false, playbackIntended = false))
    }

    @Test
    fun streamNeedsASession() {
        assertFalse(shouldHoldSessionSse(hasSessionConfig = false, appVisible = true, playbackIntended = true))
    }
}
