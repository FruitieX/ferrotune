package com.ferrotune.feature.player

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory

/**
 * Compose wrapper around the Cast `MediaRouteButton`, which owns the device
 * chooser. Visibility is controlled by the caller.
 */
@Composable
fun CastRouteButton(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            MediaRouteButton(ctx).also { button ->
                button.contentDescription = "Cast"
                CastButtonFactory.setUpMediaRouteButton(ctx, button)
            }
        },
    )
}
