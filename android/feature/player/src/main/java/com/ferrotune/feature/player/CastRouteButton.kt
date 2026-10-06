package com.ferrotune.feature.player

import android.view.View
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
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

/** Opens the Cast device chooser from places that aren't a route button (menus). */
class CastChooser internal constructor() {
    internal var button: MediaRouteButton? = null

    /** Shows the chooser; false when the hidden route button isn't attached yet. */
    fun open(): Boolean = button?.performClick() == true
}

/**
 * A [CastChooser] backed by an invisible, attached `MediaRouteButton` (the
 * chooser dialog only opens from an attached button). Call it where the
 * menu lives so the button shares that composition's lifetime.
 */
@Composable
fun rememberCastChooser(): CastChooser {
    val chooser = remember { CastChooser() }
    AndroidView(
        // Views draw outside a zero-size box, so also clip and keep it transparent.
        modifier = Modifier.size(0.dp).clipToBounds(),
        factory = { ctx ->
            MediaRouteButton(ctx).also { button ->
                button.alpha = 0f
                button.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                button.contentDescription = "Cast"
                // Clickable even before routes are discovered; the chooser shows the search.
                button.setAlwaysVisible(true)
                CastButtonFactory.setUpMediaRouteButton(ctx, button)
                chooser.button = button
            }
        },
        onRelease = { chooser.button = null },
    )
    return chooser
}
