package com.ferrotune.core.designsystem.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * The schemes below port the web client's `globals.css` design tokens. Every
 * surface role maps to a specific web token so the native app keeps the same
 * near-black canvas, card hierarchy, muted text, and border colors:
 *
 * - `background`/`surface`  -> `--background`   (0.12)
 * - `surfaceContainerLow`   -> `--card`         (0.15)
 * - `surfaceContainerHigh`  -> `--popover`      (0.17)
 * - `surfaceVariant`        -> `--secondary`    (0.22)
 * - `surfaceContainerHighest` -> `--accent`     (0.25)
 * - `outline`               -> `--border`       (0.26)
 * - `onSurfaceVariant`      -> `--muted-foreground` (0.65)
 */
private fun oklch(lightness: Double, chroma: Double, hue: Double): Color =
    oklchToColor(OklchColor(lightness, chroma, hue))

private val LightColors = lightColorScheme(
    primary = oklch(0.55, 0.16, 45.0),
    onPrimary = oklch(0.98, 0.0, 0.0),
    primaryContainer = oklch(0.90, 0.06, 45.0),
    onPrimaryContainer = oklch(0.25, 0.10, 45.0),
    secondary = oklch(0.95, 0.0, 0.0),
    onSecondary = oklch(0.10, 0.0, 0.0),
    secondaryContainer = oklch(0.95, 0.0, 0.0),
    onSecondaryContainer = oklch(0.10, 0.0, 0.0),
    tertiary = oklch(0.55, 0.10, 80.0),
    onTertiary = oklch(0.98, 0.0, 0.0),
    tertiaryContainer = oklch(0.93, 0.04, 80.0),
    onTertiaryContainer = oklch(0.25, 0.08, 80.0),
    background = oklch(0.98, 0.0, 0.0),
    onBackground = oklch(0.10, 0.0, 0.0),
    surface = oklch(0.98, 0.0, 0.0),
    onSurface = oklch(0.10, 0.0, 0.0),
    surfaceVariant = oklch(0.95, 0.0, 0.0),
    onSurfaceVariant = oklch(0.45, 0.0, 0.0),
    surfaceTint = oklch(0.55, 0.16, 45.0),
    surfaceBright = oklch(1.0, 0.0, 0.0),
    surfaceDim = oklch(0.92, 0.0, 0.0),
    surfaceContainerLowest = oklch(1.0, 0.0, 0.0),
    surfaceContainerLow = oklch(1.0, 0.0, 0.0),
    surfaceContainer = oklch(0.97, 0.0, 0.0),
    surfaceContainerHigh = oklch(0.95, 0.0, 0.0),
    surfaceContainerHighest = oklch(0.93, 0.0, 0.0),
    outline = oklch(0.90, 0.0, 0.0),
    outlineVariant = oklch(0.93, 0.0, 0.0),
    inverseSurface = oklch(0.10, 0.0, 0.0),
    inverseOnSurface = oklch(0.98, 0.0, 0.0),
    inversePrimary = oklch(0.65, 0.16, 45.0),
    error = oklch(0.55, 0.25, 25.0),
    onError = oklch(0.98, 0.0, 0.0),
    errorContainer = oklch(0.92, 0.06, 25.0),
    onErrorContainer = oklch(0.30, 0.12, 25.0),
)

private val DarkColors = darkColorScheme(
    primary = oklch(0.65, 0.16, 45.0),
    onPrimary = oklch(0.98, 0.0, 0.0),
    primaryContainer = oklch(0.30, 0.10, 45.0),
    onPrimaryContainer = oklch(0.90, 0.05, 45.0),
    secondary = oklch(0.22, 0.01, 260.0),
    onSecondary = oklch(0.98, 0.0, 0.0),
    secondaryContainer = oklch(0.25, 0.015, 260.0),
    onSecondaryContainer = oklch(0.98, 0.0, 0.0),
    tertiary = oklch(0.65, 0.10, 80.0),
    onTertiary = oklch(0.98, 0.0, 0.0),
    tertiaryContainer = oklch(0.30, 0.06, 80.0),
    onTertiaryContainer = oklch(0.92, 0.04, 80.0),
    background = oklch(0.12, 0.005, 260.0),
    onBackground = oklch(0.98, 0.0, 0.0),
    surface = oklch(0.12, 0.005, 260.0),
    onSurface = oklch(0.98, 0.0, 0.0),
    surfaceVariant = oklch(0.22, 0.01, 260.0),
    onSurfaceVariant = oklch(0.65, 0.0, 0.0),
    surfaceTint = oklch(0.65, 0.16, 45.0),
    surfaceBright = oklch(0.25, 0.015, 260.0),
    surfaceDim = oklch(0.12, 0.005, 260.0),
    surfaceContainerLowest = oklch(0.12, 0.005, 260.0),
    surfaceContainerLow = oklch(0.15, 0.005, 260.0),
    surfaceContainer = oklch(0.15, 0.005, 260.0),
    surfaceContainerHigh = oklch(0.17, 0.005, 260.0),
    surfaceContainerHighest = oklch(0.25, 0.015, 260.0),
    outline = oklch(0.26, 0.01, 260.0),
    outlineVariant = oklch(0.22, 0.01, 260.0),
    inverseSurface = oklch(0.98, 0.0, 0.0),
    inverseOnSurface = oklch(0.12, 0.005, 260.0),
    inversePrimary = oklch(0.55, 0.16, 45.0),
    error = oklch(0.65, 0.2, 25.0),
    onError = oklch(0.98, 0.0, 0.0),
    errorContainer = oklch(0.35, 0.12, 25.0),
    onErrorContainer = oklch(0.95, 0.03, 25.0),
)

@Composable
fun FerrotuneTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    accent: OklchColor? = null,
    content: @Composable () -> Unit,
) {
    val baseScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColors
        else -> LightColors
    }
    val colorScheme = accent
        ?.let { AccentColors.withAccent(baseScheme, it, darkTheme) }
        ?: baseScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = FerrotuneTypography,
        shapes = FerrotuneShapes,
        content = content,
    )
}
