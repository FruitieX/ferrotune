package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.ferrotune.core.designsystem.theme.seedGradient

/**
 * Square cover-art tile. [model] is anything Coil understands: a data URI for
 * inline thumbnails, an authenticated cover-art URL, or an `ImageRequest`.
 * When no artwork is available, a deterministic gradient seeded by [seed]
 * stands in so the layout keeps its color and rhythm.
 */
@Composable
fun CoverArt(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
    seed: String? = null,
    placeholder: ImageVector = Icons.Filled.MusicNote,
) {
    val darkTheme = isSystemInDarkTheme()
    val gradient = seedGradient(seed ?: contentDescription, darkTheme)

    Box(
        modifier = modifier
            .clip(shape)
            .background(gradient.start),
        contentAlignment = Alignment.Center,
    ) {
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        androidx.compose.ui.graphics.Brush.linearGradient(
                            listOf(gradient.start, gradient.end),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = placeholder,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier.size(24.dp),
                )
            }
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
