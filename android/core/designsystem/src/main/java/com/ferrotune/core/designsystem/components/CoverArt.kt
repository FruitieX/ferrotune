package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.ferrotune.core.designsystem.theme.coverPlaceholderColors

/**
 * Square cover-art tile. [model] is anything Coil understands: a data URI for
 * inline thumbnails, an authenticated cover-art URL, or an `ImageRequest`.
 *
 * The web `CoverImage` placeholder (a seeded 135° gradient with a white type
 * icon) sits underneath the image, so missing or still-loading artwork keeps
 * the layout's color and rhythm and loaded artwork simply covers it.
 */
@Composable
fun CoverArt(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(6.dp),
    seed: String? = null,
    placeholder: ImageVector = Icons.Filled.MusicNote,
    placeholderTint: Color? = null,
    placeholderColors: List<Color>? = null,
    iconFraction: Float = 0.4f,
    fallbackModel: Any? = null,
) {
    val seedKey = seed ?: contentDescription.orEmpty()
    val colors = placeholderColors ?: remember(seedKey) { coverPlaceholderColors(seedKey) }
    Box(
        modifier = modifier
            .clip(shape)
            .background(
                Brush.linearGradient(
                    colors = colors,
                    start = Offset.Zero,
                    end = Offset.Infinite,
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = placeholder,
            contentDescription = null,
            tint = placeholderTint ?: Color.White.copy(alpha = 0.7f),
            modifier = Modifier
                .fillMaxSize(iconFraction)
                .aspectRatio(1f),
        )
        if (fallbackModel != null && fallbackModel != model) {
            // Low-res stand-in (usually the inline thumbnail) shown while the
            // full-size [model] loads on top of it.
            AsyncImage(
                model = fallbackModel,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/**
 * Coil model for server-provided inline thumbnails (`coverArtData`).
 */
fun inlineCoverModel(coverArtData: String?): String? =
    coverArtData
        ?.takeIf { it.isNotBlank() }
        ?.let { "data:image/jpeg;base64,$it" }
