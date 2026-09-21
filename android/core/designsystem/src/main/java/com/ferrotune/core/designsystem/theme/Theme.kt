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

/** Matches the launcher icon background (`#b45309`). */
private val FerrotuneAmber = Color(0xFFB45309)

/**
 * Warm neutral surfaces tuned around the amber accent: off-white paper in
 * light mode, warm charcoal in dark mode, with a full container hierarchy for
 * layered cards and sheets.
 */
private val LightColors = lightColorScheme(
    primary = FerrotuneAmber,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFDE7CE),
    onPrimaryContainer = Color(0xFF4A2500),
    secondary = Color(0xFF7A5A3A),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF6E2CE),
    onSecondaryContainer = Color(0xFF2C1B0A),
    tertiary = Color(0xFF8A6A2F),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF8E6B8),
    onTertiaryContainer = Color(0xFF2D2000),
    background = Color(0xFFFAF8F5),
    onBackground = Color(0xFF1D1B18),
    surface = Color(0xFFFAF8F5),
    onSurface = Color(0xFF1D1B18),
    surfaceVariant = Color(0xFFEFE9E2),
    onSurfaceVariant = Color(0xFF4D463E),
    surfaceTint = FerrotuneAmber,
    surfaceBright = Color(0xFFFFFBF6),
    surfaceDim = Color(0xFFE2DCD5),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF6F2EC),
    surfaceContainer = Color(0xFFF1ECE6),
    surfaceContainerHigh = Color(0xFFEBE6E0),
    surfaceContainerHighest = Color(0xFFE5E0DA),
    outline = Color(0xFF7E776E),
    outlineVariant = Color(0xFFD2CBC3),
    inverseSurface = Color(0xFF322F2B),
    inverseOnSurface = Color(0xFFF5F0E9),
    inversePrimary = Color(0xFFFFB870),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF0A95E),
    onPrimary = Color(0xFF452300),
    primaryContainer = Color(0xFF5F3300),
    onPrimaryContainer = Color(0xFFFFDDB6),
    secondary = Color(0xFFD9BE9F),
    onSecondary = Color(0xFF3D2C18),
    secondaryContainer = Color(0xFF54402A),
    onSecondaryContainer = Color(0xFFF6E2CE),
    tertiary = Color(0xFFDCC38A),
    onTertiary = Color(0xFF3C2E05),
    tertiaryContainer = Color(0xFF55430F),
    onTertiaryContainer = Color(0xFFF8E6B8),
    background = Color(0xFF141210),
    onBackground = Color(0xFFE8E2DA),
    surface = Color(0xFF141210),
    onSurface = Color(0xFFE8E2DA),
    surfaceVariant = Color(0xFF2C2823),
    onSurfaceVariant = Color(0xFFB5ADA2),
    surfaceTint = Color(0xFFF0A95E),
    surfaceBright = Color(0xFF3B3732),
    surfaceDim = Color(0xFF141210),
    surfaceContainerLowest = Color(0xFF0E0D0B),
    surfaceContainerLow = Color(0xFF1B1917),
    surfaceContainer = Color(0xFF1F1D1A),
    surfaceContainerHigh = Color(0xFF2A2723),
    surfaceContainerHighest = Color(0xFF35312C),
    outline = Color(0xFF8F887D),
    outlineVariant = Color(0xFF45403A),
    inverseSurface = Color(0xFFE8E2DA),
    inverseOnSurface = Color(0xFF322F2B),
    inversePrimary = FerrotuneAmber,
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
    errorContainer = Color(0xFF8C1D18),
    onErrorContainer = Color(0xFFF9DEDC),
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
