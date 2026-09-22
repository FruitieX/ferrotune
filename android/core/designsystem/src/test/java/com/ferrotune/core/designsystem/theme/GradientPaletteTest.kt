package com.ferrotune.core.designsystem.theme

import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GradientPaletteTest {

    @Test
    fun `seed gradient is deterministic for the same seed`() {
        assertEquals(seedGradient("Album 1", darkTheme = true), seedGradient("Album 1", darkTheme = true))
        assertEquals(seedGradient("Album 1", darkTheme = false), seedGradient("Album 1", darkTheme = false))
    }

    @Test
    fun `different seeds produce different gradients`() {
        val first = seedGradient("Album 1", darkTheme = true)
        val second = seedGradient("Album 2", darkTheme = true)
        assertNotEquals(first.start, second.start)
    }

    @Test
    fun `null seed falls back to a stable gradient`() {
        assertEquals(seedGradient(null, darkTheme = false), seedGradient("ferrotune", darkTheme = false))
    }

    @Test
    fun `dark gradients are darker than light gradients`() {
        val light = seedGradient("Album", darkTheme = false)
        val dark = seedGradient("Album", darkTheme = true)
        assertTrue(dark.start.luminance() < light.start.luminance())
    }
}
