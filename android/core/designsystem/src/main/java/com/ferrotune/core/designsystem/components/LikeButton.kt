package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ferrotune.core.designsystem.theme.FavoriteRed

/** Lucide's `heart-plus` (ISC license), the web client's like icon. */
val HeartPlusIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "HeartPlus",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        listOf(
            "m14.479 19.374-.971.939a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 " +
                "9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5a5.2 5.2 0 0 1-.219 1.49",
            "M15 15h6",
            "M18 12v6",
        ).forEach { path ->
            addPath(
                pathData = addPathNodes(path),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()
}

/**
 * The like counter beside the favorite heart: each tap adds a like to the
 * song, and a tap while [recentlyLiked] (within the server's undo window of
 * the newest like) takes that like back. Shows the count once there is one.
 */
@Composable
fun LikeButton(
    likeCount: Int,
    recentlyLiked: Boolean,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    iconSize: Dp = 22.dp,
) {
    val tint = if (recentlyLiked) FavoriteRed else MaterialTheme.colorScheme.onSurfaceVariant
    val label = when {
        recentlyLiked -> "Undo like, $likeCount ${if (likeCount == 1) "like" else "likes"}"
        likeCount > 0 -> "Like again, $likeCount ${if (likeCount == 1) "like" else "likes"}"
        else -> "Like"
    }
    Row(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onTap)
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(imageVector = HeartPlusIcon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
        if (likeCount > 0) {
            Text(
                text = likeCount.toString(),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = tint,
            )
        }
    }
}
