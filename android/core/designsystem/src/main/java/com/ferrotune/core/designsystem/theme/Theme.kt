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

private val LightColors = lightColorScheme(
    primary = FerrotuneAmber,
)

private val DarkColors = darkColorScheme(
    primary = FerrotuneAmber,
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
        content = content,
    )
}
