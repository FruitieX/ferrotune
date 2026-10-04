package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val CardShape = RoundedCornerShape(8.dp)
private val CoverShape = RoundedCornerShape(6.dp)

/**
 * Touch variant of the web `MediaCard`: an 8dp-padded `bg-card` tile with a
 * square cover, an optional type icon before the semibold title, and a muted
 * subtitle. Circular covers (artists) center their text. Tap opens, long-press
 * opens the action sheet; the web hides the hover play overlay on touch, so
 * this card has none either.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaCard(
    title: String,
    subtitle: String?,
    coverModel: Any?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    seed: String? = null,
    circularCover: Boolean = false,
    titleIcon: ImageVector? = null,
    titleIconTint: Color? = null,
    placeholder: ImageVector = titleIcon ?: Icons.Filled.Album,
    placeholderColors: List<Color>? = null,
    placeholderTint: Color? = null,
    isActive: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = modifier
            .clip(CardShape)
            .background(
                if (isActive) colors.surfaceContainerHighest.copy(alpha = 0.3f) else colors.surfaceContainerLow,
            )
            .then(
                if (isActive) Modifier.border(2.dp, colors.primary.copy(alpha = 0.4f), CardShape) else Modifier,
            )
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(8.dp),
        horizontalAlignment = if (circularCover) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        CoverArt(
            model = coverModel,
            contentDescription = title,
            seed = seed ?: title,
            shape = if (circularCover) CircleShape else CoverShape,
            placeholder = placeholder,
            placeholderColors = placeholderColors,
            placeholderTint = placeholderTint,
            iconFraction = 0.33f,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f),
        )
        Spacer(Modifier.height(8.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally.takeIf { circularCover } ?: Alignment.Start),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (titleIcon != null) {
                Icon(
                    imageVector = titleIcon,
                    contentDescription = null,
                    tint = titleIconTint ?: colors.onSurfaceVariant,
                    modifier = Modifier.size(15.dp),
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = if (isActive) colors.primary else colors.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = if (circularCover) TextAlign.Center else TextAlign.Start,
                modifier = Modifier.weight(1f, fill = !circularCover),
            )
        }
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = if (circularCover) TextAlign.Center else TextAlign.Start,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Fixed-width [MediaCard] for horizontal shelves (web uses 130px on phones). */
@Composable
fun ShelfCard(
    title: String,
    subtitle: String?,
    coverModel: Any?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = ShelfCardWidth,
    seed: String? = null,
    circularCover: Boolean = false,
    titleIcon: ImageVector? = null,
    titleIconTint: Color? = null,
    placeholderColors: List<Color>? = null,
    placeholderTint: Color? = null,
    isActive: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    MediaCard(
        title = title,
        subtitle = subtitle,
        coverModel = coverModel,
        onClick = onClick,
        modifier = modifier.width(width),
        seed = seed,
        circularCover = circularCover,
        titleIcon = titleIcon,
        titleIconTint = titleIconTint,
        placeholderColors = placeholderColors,
        placeholderTint = placeholderTint,
        isActive = isActive,
        onLongClick = onLongClick,
    )
}

/** Web home shelf item width on small screens. */
val ShelfCardWidth: Dp = 136.dp

/** Grid cell minimum width that yields the web's three columns on phones. */
val MediaGridMinCellWidth: Dp = 104.dp

/** Box used by grid skeletons to match [MediaCard] proportions. */
@Composable
fun MediaCardSkeleton(modifier: Modifier = Modifier, width: Dp? = null) {
    Column(
        modifier = modifier
            .then(if (width != null) Modifier.width(width) else Modifier)
            .clip(CardShape)
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(8.dp),
    ) {
        ShimmerBox(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f),
            shape = CoverShape,
        )
        Spacer(Modifier.height(10.dp))
        ShimmerBox(modifier = Modifier.fillMaxWidth(0.75f).height(14.dp))
        Spacer(Modifier.height(6.dp))
        ShimmerBox(modifier = Modifier.fillMaxWidth(0.5f).height(12.dp))
    }
}
