package com.ferrotune.audio

import androidx.media3.common.Player
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackResumeLogicTest {
    @Test
    fun requiresReprepareForEndedAndIdle() {
        assertTrue(PlaybackResumeLogic.requiresReprepareToResume(Player.STATE_ENDED))
        assertTrue(PlaybackResumeLogic.requiresReprepareToResume(Player.STATE_IDLE))
    }

    @Test
    fun resumableStatesDoNotRequireReprepare() {
        assertFalse(PlaybackResumeLogic.requiresReprepareToResume(Player.STATE_READY))
        assertFalse(PlaybackResumeLogic.requiresReprepareToResume(Player.STATE_BUFFERING))
    }

    @Test
    fun onlyEndedResetsToItemStart() {
        assertTrue(PlaybackResumeLogic.shouldResetToItemStartBeforeReprepare(Player.STATE_ENDED))
        assertFalse(PlaybackResumeLogic.shouldResetToItemStartBeforeReprepare(Player.STATE_IDLE))
        assertFalse(PlaybackResumeLogic.shouldResetToItemStartBeforeReprepare(Player.STATE_READY))
        assertFalse(PlaybackResumeLogic.shouldResetToItemStartBeforeReprepare(Player.STATE_BUFFERING))
    }
}
