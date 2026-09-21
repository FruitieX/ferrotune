package com.ferrotune.core.designsystem.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AccentPaletteTest {

    @Test
    fun `oklch conversion matches the web client values`() {
        assertEquals("#dc692e", oklchToHex(OklchColor(0.65, 0.16, 45.0)))
        assertEquals("#d9a514", oklchToHex(OklchColor(0.75, 0.15, 85.0)))
        assertEquals("#e52754", oklchToHex(OklchColor(0.60, 0.22, 15.0)))
        assertEquals("#00747a", oklchToHex(OklchColor(0.50, 0.10, 200.0)))
    }

    @Test
    fun `presets match the web stylesheet`() {
        val expected = mapOf(
            "rust" to OklchColor(0.65, 0.16, 45.0),
            "gold" to OklchColor(0.75, 0.15, 85.0),
            "lime" to OklchColor(0.75, 0.18, 125.0),
            "emerald" to OklchColor(0.65, 0.18, 160.0),
            "teal" to OklchColor(0.70, 0.15, 195.0),
            "ocean" to OklchColor(0.60, 0.16, 230.0),
            "indigo" to OklchColor(0.60, 0.18, 265.0),
            "violet" to OklchColor(0.65, 0.20, 300.0),
            "rose" to OklchColor(0.65, 0.20, 340.0),
            "crimson" to OklchColor(0.60, 0.22, 15.0),
        )
        assertEquals(expected.size, AccentColors.PRESETS.size)
        expected.forEach { (name, color) ->
            assertEquals(color, AccentColors.resolve(name))
        }
    }

    @Test
    fun `custom accent resolves and clamps to slider ranges`() {
        val custom = AccentColors.clampCustom(lightness = 1.4, chroma = 0.5, hue = 405.0)
        assertEquals(0.9, custom.lightness, 0.0001)
        assertEquals(0.3, custom.chroma, 0.0001)
        assertEquals(45.0, custom.hue, 0.0001)
        assertEquals(custom, AccentColors.resolve(AccentColors.CUSTOM, custom))
    }

    @Test
    fun `unknown accent names fall back to rust`() {
        assertEquals(AccentColors.resolve("rust"), AccentColors.resolve("nope"))
    }

    @Test
    fun `needs dark foreground above lightness threshold`() {
        assertTrue(AccentColors.needsDarkForeground(0.75))
        assertFalse(AccentColors.needsDarkForeground(0.65))
    }

    @Test
    fun `withAccent overrides primary and derives containers`() {
        val base = darkColorScheme()
        val accent = AccentColors.resolve("rust")

        val themed = AccentColors.withAccent(base, accent, darkTheme = true)

        assertEquals(oklchToColor(accent), themed.primary)
        assertNotEquals(base.primary, themed.primary)
        assertNotEquals(base.primaryContainer, themed.primaryContainer)
        assertNotEquals(base.secondary, themed.secondary)
        assertNotEquals(base.tertiary, themed.tertiary)
    }

    @Test
    fun `light and dark schemes derive different containers`() {
        val accent = AccentColors.resolve("gold")
        val dark = AccentColors.withAccent(darkColorScheme(), accent, darkTheme = true)
        val light = AccentColors.withAccent(lightColorScheme(), accent, darkTheme = false)

        assertNotEquals(dark.primaryContainer, light.primaryContainer)
        assertNotEquals(dark.onPrimaryContainer, light.onPrimaryContainer)
        assertEquals(dark.primary, light.primary)
    }
}
