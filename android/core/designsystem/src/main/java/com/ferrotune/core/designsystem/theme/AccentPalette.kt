package com.ferrotune.core.designsystem.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** OKLCH color, matching the web client's accent color model. */
data class OklchColor(
    val lightness: Double,
    val chroma: Double,
    val hue: Double,
)

data class AccentPreset(
    val name: String,
    val label: String,
    val color: OklchColor,
)

/**
 * Accent presets mirroring `client/src/app/globals.css` (`[data-accent=...]`
 * dark-theme primary values) and the web custom accent slider ranges.
 */
object AccentColors {
    const val CUSTOM = "custom"
    const val DEFAULT = "rust"

    val PRESETS = listOf(
        AccentPreset("rust", "Rust", OklchColor(0.65, 0.16, 45.0)),
        AccentPreset("gold", "Gold", OklchColor(0.75, 0.15, 85.0)),
        AccentPreset("lime", "Lime", OklchColor(0.75, 0.18, 125.0)),
        AccentPreset("emerald", "Emerald", OklchColor(0.65, 0.18, 160.0)),
        AccentPreset("teal", "Teal", OklchColor(0.70, 0.15, 195.0)),
        AccentPreset("ocean", "Ocean", OklchColor(0.60, 0.16, 230.0)),
        AccentPreset("indigo", "Indigo", OklchColor(0.60, 0.18, 265.0)),
        AccentPreset("violet", "Violet", OklchColor(0.65, 0.20, 300.0)),
        AccentPreset("rose", "Rose", OklchColor(0.65, 0.20, 340.0)),
        AccentPreset("crimson", "Crimson", OklchColor(0.60, 0.22, 15.0)),
    )

    const val DEFAULT_CUSTOM_HUE = 45.0
    const val DEFAULT_CUSTOM_LIGHTNESS = 0.65
    const val DEFAULT_CUSTOM_CHROMA = 0.18

    val DEFAULT_CUSTOM = OklchColor(
        DEFAULT_CUSTOM_LIGHTNESS,
        DEFAULT_CUSTOM_CHROMA,
        DEFAULT_CUSTOM_HUE,
    )

    fun resolve(name: String, custom: OklchColor = DEFAULT_CUSTOM): OklchColor =
        if (name == CUSTOM) {
            custom
        } else {
            PRESETS.firstOrNull { it.name == name }?.color ?: PRESETS.first().color
        }

    /** Matches the web helper: lightness above 0.7 reads as light and needs dark text. */
    fun needsDarkForeground(lightness: Double): Boolean = lightness > 0.7

    /** Clamps custom accent values to the web slider ranges. */
    fun clampCustom(lightness: Double, chroma: Double, hue: Double): OklchColor = OklchColor(
        lightness = lightness.coerceIn(0.3, 0.9),
        chroma = chroma.coerceIn(0.01, 0.3),
        hue = ((hue % 360.0) + 360.0) % 360.0,
    )

    fun withAccent(scheme: ColorScheme, accent: OklchColor, darkTheme: Boolean): ColorScheme {
        val primary = oklchToColor(accent)
        val onPrimary = if (needsDarkForeground(accent.lightness)) {
            Color(0xFF1C1917)
        } else {
            Color(0xFFFFFFFF)
        }
        val containerLightness = if (darkTheme) {
            (accent.lightness * 0.4).coerceAtLeast(0.2)
        } else {
            (accent.lightness + 0.25).coerceAtMost(0.92)
        }
        val primaryContainer = oklchToColor(
            accent.copy(lightness = containerLightness, chroma = accent.chroma * 0.6),
        )
        val onPrimaryContainer = oklchToColor(
            if (darkTheme) {
                accent.copy(lightness = 0.9, chroma = accent.chroma * 0.25)
            } else {
                accent.copy(lightness = 0.25, chroma = accent.chroma)
            },
        )
        val secondary = oklchToColor(accent.copy(chroma = accent.chroma * 0.6))
        val tertiary = oklchToColor(accent.copy(hue = (accent.hue + 35.0) % 360.0))

        return scheme.copy(
            primary = primary,
            onPrimary = onPrimary,
            primaryContainer = primaryContainer,
            onPrimaryContainer = onPrimaryContainer,
            secondary = secondary,
            tertiary = tertiary,
        )
    }
}

/** Port of the web client's `oklchToRgb` (OKLab -> linear sRGB -> gamma). */
fun oklchToColor(color: OklchColor): Color {
    val hRad = Math.toRadians(color.hue)
    val a = color.chroma * cos(hRad)
    val b = color.chroma * sin(hRad)

    val l = color.lightness + 0.3963377774 * a + 0.2158037573 * b
    val m = color.lightness - 0.1055613458 * a - 0.0638541728 * b
    val s = color.lightness - 0.0894841775 * a - 1.291485548 * b

    val lCubed = l * l * l
    val mCubed = m * m * m
    val sCubed = s * s * s

    val rLinear = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed
    val gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed
    val bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed

    return Color(
        red = linearToSrgb(rLinear),
        green = linearToSrgb(gLinear),
        blue = linearToSrgb(bLinear),
    )
}

private fun linearToSrgb(value: Double): Float {
    val corrected = if (value <= 0.0031308) {
        12.92 * value
    } else {
        1.055 * value.coerceAtLeast(0.0).pow(1.0 / 2.4) - 0.055
    }
    return corrected.coerceIn(0.0, 1.0).toFloat()
}

private fun Double.pow(exponent: Double): Double = Math.pow(this, exponent)

/** Rounds an OKLCH color to a `#rrggbb` string for tests/diagnostics. */
fun oklchToHex(color: OklchColor): String {
    val argb = oklchToColor(color)
    val r = (argb.red * 255).roundToInt()
    val g = (argb.green * 255).roundToInt()
    val b = (argb.blue * 255).roundToInt()
    return "#%02x%02x%02x".format(r, g, b)
}
