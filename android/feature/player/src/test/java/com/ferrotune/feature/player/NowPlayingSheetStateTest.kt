package com.ferrotune.feature.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NowPlayingSheetStateTest {

    private val immediateAnimator = SheetAnimator { _, target, _, onValue -> onValue(target) }

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
    fun `expand drag opens after a fifth of the height is pulled`() {
        val state = state()

        state.dragBy(-100f)
        assertEquals(0.9f, state.fraction, 0.01f)
        assertFalse(state.shouldOpenOnRelease())

        state.dragBy(-150f)
        assertEquals(0.75f, state.fraction, 0.01f)
        assertTrue(state.shouldOpenOnRelease())
    }

    @Test
    fun `back progress positions the sheet directly`() {
        val state = state()

        state.dragToFraction(0.5f)
        assertEquals(500f, state.offsetY, 0.01f)
        assertEquals(0.5f, state.fraction, 0.01f)

        state.dragToFraction(1f)
        assertEquals(1000f, state.offsetY, 0.01f)
    }

    @Test
    fun `drag does nothing before the overlay has been measured`() {
        val state = NowPlayingSheetState(CoroutineScope(UnconfinedTestDispatcher()))

        state.dragBy(-100f)

        assertFalse(state.rendered)
        assertEquals(0f, state.offsetY, 0.01f)
    }

    @Test
    fun `art drag accumulates and settles back to rest`() = runTest {
        val state = NowPlayingSheetState(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            immediateAnimator,
        ).apply {
            hiddenOffsetPx = 1000f
            artDistancePx = 500f
        }

        state.dragArtBy(-120f)
        assertTrue(state.artDragging)
        assertEquals(-120f, state.artOffsetX, 0.01f)

        state.settleArt()
        assertFalse(state.artDragging)
        advanceUntilIdle()
        assertEquals(0f, state.artOffsetX, 0.01f)
    }

    @Test
    fun `committing an art swipe slides out, commits, and recenters`() = runTest {
        val state = NowPlayingSheetState(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            immediateAnimator,
        ).apply {
            hiddenOffsetPx = 1000f
            artDistancePx = 500f
        }

        state.dragArtBy(-80f)
        var committed = false
        state.commitArtSwipe(direction = -1, fromTrackId = "song-1") { committed = true }

        advanceUntilIdle()
        assertTrue(committed)
        assertFalse(state.artDragging)
        assertEquals(0f, state.artOffsetX, 0.01f)
    }

    @Test
    fun `art stays out until the committed track arrives`() = runTest {
        val state = NowPlayingSheetState(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            immediateAnimator,
        ).apply {
            hiddenOffsetPx = 1000f
            artDistancePx = 500f
        }

        state.dragArtBy(-80f)
        state.commitArtSwipe(direction = -1, fromTrackId = "song-1") {}

        assertEquals(-500f, state.artOffsetX, 0.01f)

        // The outgoing track re-render must not recenter the artwork.
        state.onTrackChanged("song-1")
        assertEquals(-500f, state.artOffsetX, 0.01f)

        // The incoming track recenters it immediately.
        state.onTrackChanged("song-2")
        assertEquals(0f, state.artOffsetX, 0.01f)
    }

    @Test
    fun `art recenters when the committed track never arrives`() = runTest {
        val state = NowPlayingSheetState(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            immediateAnimator,
        ).apply {
            hiddenOffsetPx = 1000f
            artDistancePx = 500f
        }

        state.dragArtBy(-80f)
        state.commitArtSwipe(direction = -1, fromTrackId = "song-1") {}

        advanceUntilIdle()
        assertEquals(0f, state.artOffsetX, 0.01f)
    }
}
