package com.ferrotune.core.designsystem.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WaveformBarLayoutTest {

    @Test
    fun `tooltip is centered on the percent`() {
        assertEquals(90f, progressTooltipLeft(0.5f, 20f, 200f), 0.01f)
    }

    @Test
    fun `tooltip clamps to the container edges`() {
        assertEquals(0f, progressTooltipLeft(0f, 40f, 200f), 0.01f)
        assertEquals(160f, progressTooltipLeft(1f, 40f, 200f), 0.01f)
    }

    @Test
    fun `tooltip clamps and ignores percents outside the container`() {
        assertEquals(0f, progressTooltipLeft(-0.5f, 40f, 200f), 0.01f)
        assertEquals(160f, progressTooltipLeft(1.5f, 40f, 200f), 0.01f)
    }

    @Test
    fun `tooltip left is zero when the label is wider than the container`() {
        assertEquals(0f, progressTooltipLeft(0.5f, 240f, 200f), 0.01f)
    }

    @Test
    fun `labels collide when they overlap within the padding`() {
        assertTrue(
            progressTooltipsCollide(
                firstLeft = 80f,
                firstWidth = 40f,
                secondLeft = 110f,
                secondWidth = 40f,
                padding = 8f,
            ),
        )
    }

    @Test
    fun `labels do not collide when separated by the padding`() {
        assertFalse(
            progressTooltipsCollide(
                firstLeft = 40f,
                firstWidth = 40f,
                secondLeft = 120f,
                secondWidth = 40f,
                padding = 8f,
            ),
        )
    }
}
