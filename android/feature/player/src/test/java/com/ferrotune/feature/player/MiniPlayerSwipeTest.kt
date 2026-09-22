package com.ferrotune.feature.player

import org.junit.Assert.assertEquals
import org.junit.Test

class MiniPlayerSwipeTest {

    @Test
    fun `swipe past the distance threshold goes next`() {
        assertEquals(-1, miniPlayerSwipeDirection(-60f, 0f, 50f, 300f))
    }

    @Test
    fun `swipe past the distance threshold goes previous`() {
        assertEquals(1, miniPlayerSwipeDirection(60f, 0f, 50f, 300f))
    }

    @Test
    fun `fling velocity commits even below the distance threshold`() {
        assertEquals(-1, miniPlayerSwipeDirection(-10f, -400f, 50f, 300f))
        assertEquals(1, miniPlayerSwipeDirection(10f, 400f, 50f, 300f))
    }

    @Test
    fun `small slow drags settle back`() {
        assertEquals(0, miniPlayerSwipeDirection(-20f, -100f, 50f, 300f))
        assertEquals(0, miniPlayerSwipeDirection(0f, 0f, 50f, 300f))
    }

    @Test
    fun `preview alpha ramps to half at the threshold and full at the commit distance`() {
        assertEquals(0f, miniPlayerSwipePreviewAlpha(0f, 50f, 300f), 0.01f)
        assertEquals(0.5f, miniPlayerSwipePreviewAlpha(50f, 50f, 300f), 0.01f)
        assertEquals(1f, miniPlayerSwipePreviewAlpha(300f, 50f, 300f), 0.01f)
    }

    @Test
    fun `preview alpha ignores direction and clamps overshoot`() {
        assertEquals(
            miniPlayerSwipePreviewAlpha(100f, 50f, 300f),
            miniPlayerSwipePreviewAlpha(-100f, 50f, 300f),
            0.01f,
        )
        assertEquals(1f, miniPlayerSwipePreviewAlpha(600f, 50f, 300f), 0.01f)
    }
}
