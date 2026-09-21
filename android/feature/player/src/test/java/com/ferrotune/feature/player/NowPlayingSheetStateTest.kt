package com.ferrotune.feature.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NowPlayingSheetStateTest {

    private fun state(hidden: Float = 1000f): NowPlayingSheetState =
        NowPlayingSheetState(CoroutineScope(UnconfinedTestDispatcher())).apply {
            hiddenOffsetPx = hidden
        }

    @Test
    fun `drag up from the mini player reveals the sheet progressively`() {
        val state = state()

        assertFalse(state.rendered)
        state.dragBy(-150f)

        assertTrue(state.rendered)
        assertEquals(850f, state.offsetY, 0.01f)
    }

    @Test
    fun `drag is clamped to the open and hidden offsets`() {
        val state = state()

        state.dragBy(-5000f)
        assertEquals(0f, state.offsetY, 0.01f)

        state.dragBy(5000f)
        assertEquals(1000f, state.offsetY, 0.01f)
    }

    @Test
    fun `release closes only past a quarter of the height`() {
        val state = state()

        state.dragBy(-200f)
        assertEquals(0.8f, state.fraction, 0.01f)
        assertTrue(state.shouldCloseOnRelease())

        state.dragBy(-600f)
        assertEquals(0.2f, state.fraction, 0.01f)
        assertFalse(state.shouldCloseOnRelease())
    }

    @Test
    fun `drag does nothing before the overlay has been measured`() {
        val state = NowPlayingSheetState(CoroutineScope(UnconfinedTestDispatcher()))

        state.dragBy(-100f)

        assertFalse(state.rendered)
        assertEquals(0f, state.offsetY, 0.01f)
    }
}
