package com.ferrotune.core.designsystem.components

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

/**
 * Full-bleed detail-page backdrop matching the web client's `DetailHeader`:
 * a vertical gradient from the seeded color to the app background, optionally
 * overlaid with a blurred cover image. Drawn behind the status bar and top
 * chrome so the gradient starts at the very top of the screen.
 */
@Composable
fun DetailBackdrop(
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 400.dp,
    coverModel: Any? = null,
    blurred: Boolean = false,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .then(if (height != Dp.Unspecified) Modifier.height(height) else Modifier),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(color, MaterialTheme.colorScheme.background),
                    ),
                ),
        )
        if (blurred && coverModel != null) {
            AsyncImage(
                model = coverModel,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .clipToBounds()
                    .then(
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            Modifier.blur(64.dp)
                        } else {
                            Modifier
                        },
                    ),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.6f)),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, MaterialTheme.colorScheme.background),
                        ),
                    ),
            )
        }
    }
}

/**
 * Header block of a detail screen: [DetailBackdrop] sized to the header and
 * action bar it wraps, so the gradient scrolls away with them (web
 * `DetailHeader` + `ActionBar`) instead of staying pinned behind the list.
 * Place it as the first item of the screen's lazy list or grid.
 */
@Composable
fun DetailHero(
    backdropColor: Color,
    modifier: Modifier = Modifier,
    coverModel: Any? = null,
    blurredCover: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        DetailBackdrop(
            color = backdropColor,
            coverModel = coverModel,
            blurred = blurredCover,
            modifier = Modifier.matchParentSize(),
            height = Dp.Unspecified,
        )
        Column(modifier = Modifier.fillMaxWidth(), content = content)
    }
}

/**
 * Lets a full-width item (like a [DetailHero] in a padded lazy grid) extend
 * [bleed] past its parent's horizontal content padding on both sides.
 */
fun Modifier.bleedHorizontal(bleed: Dp): Modifier = layout { measurable, constraints ->
    val extra = bleed.roundToPx() * 2
    val placeable = measurable.measure(
        constraints.copy(
            minWidth = (constraints.minWidth + extra).coerceAtLeast(0),
            maxWidth = if (constraints.hasBoundedWidth) constraints.maxWidth + extra else constraints.maxWidth,
        ),
    )
    layout(placeable.width - extra, placeable.height) {
        placeable.place(-bleed.roundToPx(), 0)
    }
}
