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
    fun `release closes after the web's 100dp pull or a fast flick past 40dp`() {
        val state = state().apply { density = 2f }
        state.dragToFraction(0f)

        state.dragBy(150f) // 75dp
        assertFalse(state.shouldCloseOnRelease())
        assertTrue(state.shouldCloseOnRelease(velocityY = 1_200f)) // 600dp/s

        state.dragBy(60f) // 105dp
        assertTrue(state.shouldCloseOnRelease())

        state.dragToFraction(0f)
        state.dragBy(60f) // 30dp: even a fast flick is too short
        assertFalse(state.shouldCloseOnRelease(velocityY = 2_000f))
    }

    @Test
    fun `expand drag opens after the web's 50dp pull or an upward flick`() {
        val state = state().apply { density = 2f }

        state.dragBy(-80f) // 40dp
        assertFalse(state.shouldOpenOnRelease())
        assertTrue(state.shouldOpenOnRelease(velocityY = -800f))

        state.dragBy(-40f) // 60dp
        assertTrue(state.shouldOpenOnRelease())
        // Flicking back down at release cancels.
        assertFalse(state.shouldOpenOnRelease(velocityY = 800f))
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
