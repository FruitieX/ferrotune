package com.ferrotune.audio

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
    fun owningServiceReconnectsBeforeMediaIsLoaded() {
        assertTrue(
            shouldReconnectSessionSse(
                nativeOwnsSession = true,
                hasSessionConfig = true,
            ),
        )
        assertFalse(
            shouldReconnectSessionSse(
                nativeOwnsSession = false,
                hasSessionConfig = true,
            ),
        )
        assertFalse(
            shouldReconnectSessionSse(
                nativeOwnsSession = true,
                hasSessionConfig = false,
            ),
        )
    }
}
