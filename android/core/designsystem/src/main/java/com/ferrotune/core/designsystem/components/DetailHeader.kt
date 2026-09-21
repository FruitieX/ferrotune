package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ferrotune.core.designsystem.theme.seedGradient

/**
 * Shared detail-screen header: seeded gradient backdrop, artwork, title,
 * subtitle, optional badges (album type, counts) and an action row
 * (play/shuffle/star/download/more).
 */
@Composable
fun DetailHeader(
    title: String,
    subtitle: String?,
    modifier: Modifier = Modifier,
    coverModel: Any? = null,
    seed: String? = null,
    circularCover: Boolean = false,
    coverSize: Dp = 156.dp,
    onSubtitleClick: (() -> Unit)? = null,
    badges: (@Composable RowScope.() -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val darkTheme = isSystemInDarkTheme()
    val gradient = seedGradient(seed ?: title, darkTheme)
    val glowAlpha = if (darkTheme) 0.32f else 0.5f

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(
                        gradient.glow.copy(alpha = glowAlpha),
                        gradient.end.copy(alpha = glowAlpha * 0.35f),
                        Color.Transparent,
                    ),
                ),
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CoverArt(
                model = coverModel,
                contentDescription = title,
                seed = seed ?: title,
                shape = if (circularCover) CircleShape else RoundedCornerShape(16.dp),
                modifier = Modifier
                    .size(coverSize)
                    .clip(if (circularCover) CircleShape else RoundedCornerShape(16.dp)),
            )
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (onSubtitleClick != null) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = if (onSubtitleClick != null) {
                            Modifier.clickable(onClick = onSubtitleClick)
                        } else {
                            Modifier
                        },
                    )
                }
            }
            if (badges != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = badges,
                )
            }
            if (actions != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = actions,
                )
            }
        }
    }
}
