package com.ferrotune.core.designsystem.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Deterministic, seed-based gradient colors used as artwork fallbacks and
 * detail-header backdrops. Mirrors the web client's seeded cover gradient so a
 * given album/artist always gets the same hue family.
 */
data class SeedGradient(
    val start: Color,
    val end: Color,
    val glow: Color,
)

fun seedGradient(seed: String?, darkTheme: Boolean): SeedGradient {
    val hash = (seed ?: "ferrotune").fold(0) { acc, char -> (acc * 31 + char.code) and 0x7FFFFFFF }
    val hue = (hash % 360).toDouble()
    val secondaryHue = (hue + 28.0) % 360.0
    return if (darkTheme) {
        SeedGradient(
            start = oklchToColor(OklchColor(lightness = 0.34, chroma = 0.09, hue = hue)),
            end = oklchToColor(OklchColor(lightness = 0.22, chroma = 0.06, hue = secondaryHue)),
            glow = oklchToColor(OklchColor(lightness = 0.62, chroma = 0.14, hue = hue)),
        )
    } else {
        SeedGradient(
            start = oklchToColor(OklchColor(lightness = 0.88, chroma = 0.07, hue = hue)),
            end = oklchToColor(OklchColor(lightness = 0.78, chroma = 0.09, hue = secondaryHue)),
            glow = oklchToColor(OklchColor(lightness = 0.72, chroma = 0.12, hue = hue)),
        )
    }
}

fun seedGradientBrush(seed: String?, darkTheme: Boolean): Brush {
    val gradient = seedGradient(seed, darkTheme)
    return Brush.linearGradient(listOf(gradient.start, gradient.end))
}
