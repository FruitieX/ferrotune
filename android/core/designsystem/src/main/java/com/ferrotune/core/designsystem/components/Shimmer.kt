package com.ferrotune.core.designsystem.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Animated placeholder block used while lists and cards load. */
@Composable
fun ShimmerBox(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val offset by transition.animateFloat(
        initialValue = -600f,
        targetValue = 1400f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1400, easing = LinearEasing),
        ),
        label = "shimmer-offset",
    )
    val base = MaterialTheme.colorScheme.surfaceContainerHigh
    val highlight = MaterialTheme.colorScheme.surfaceContainerHighest
    Box(
        modifier = modifier
            .clip(shape)
            .background(
                Brush.linearGradient(
                    colors = listOf(base, highlight, base),
                    start = Offset(offset - 400f, 0f),
                    end = Offset(offset, 400f),
                ),
            ),
    )
}

/** Placeholder matching the [MediaRow] layout. */
@Composable
fun MediaRowSkeleton(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ShimmerBox(modifier = Modifier.size(48.dp), shape = RoundedCornerShape(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ShimmerBox(modifier = Modifier.width(180.dp).height(14.dp), shape = CircleShape)
            ShimmerBox(modifier = Modifier.width(110.dp).height(12.dp), shape = CircleShape)
        }
    }
}

/** Placeholder matching the [MediaCard] layout. */
@Composable
fun MediaCardSkeleton(width: Dp, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.width(width),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ShimmerBox(modifier = Modifier.fillMaxWidth().height(width), shape = RoundedCornerShape(12.dp))
        ShimmerBox(modifier = Modifier.fillMaxWidth(0.8f).height(13.dp), shape = CircleShape)
        ShimmerBox(modifier = Modifier.fillMaxWidth(0.55f).height(11.dp), shape = CircleShape)
    }
}

@Composable
fun MediaRowSkeletonList(
    count: Int,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        repeat(count) { MediaRowSkeleton() }
    }
}
