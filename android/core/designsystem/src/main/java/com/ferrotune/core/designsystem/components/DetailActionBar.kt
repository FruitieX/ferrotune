package com.ferrotune.core.designsystem.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** List/grid item key for the in-list action bar that [rememberActionBarPinned] tracks. */
const val ACTION_BAR_ITEM_KEY = "detail-action-bar"

/**
 * The web `ActionBar`: a 48dp primary play button and an outlined shuffle
 * button followed by screen actions (filter, ⋯), on the web's translucent
 * `bg-background/80` strip with a bottom border.
 */
@Composable
fun DetailActionBar(
    modifier: Modifier = Modifier,
    onPlayAll: (() -> Unit)? = null,
    onShuffle: (() -> Unit)? = null,
    playEnabled: Boolean = true,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.8f)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (onPlayAll != null) {
                FilledIconButton(
                    onClick = onPlayAll,
                    enabled = playEnabled,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.PlayArrow,
                        contentDescription = "Play",
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            if (onShuffle != null) {
                OutlinedIconButton(
                    onClick = onShuffle,
                    enabled = playEnabled,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Shuffle,
                        contentDescription = "Shuffle",
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            if (actions != null) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    content = actions,
                )
            } else if (onPlayAll != null || onShuffle != null) {
                Row(modifier = Modifier.weight(1f)) {}
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}

/**
 * True once the list's action bar item (keyed [ACTION_BAR_ITEM_KEY]) has
 * scrolled up under the status bar, i.e. when the web's sticky action bar
 * would be pinned to the top.
 */
@Composable
fun rememberActionBarPinned(listState: LazyListState): State<Boolean> {
    val statusBarPx = WindowInsets.statusBars.getTop(LocalDensity.current)
    return remember(listState, statusBarPx) {
        derivedStateOf {
            val info = listState.layoutInfo
            val bar = info.visibleItemsInfo.firstOrNull { it.key == ACTION_BAR_ITEM_KEY }
            if (bar == null) {
                // The bar sits right below the header, so off screen means scrolled past.
                listState.firstVisibleItemIndex > 0
            } else {
                bar.offset < statusBarPx
            }
        }
    }
}

/** Grid variant of [rememberActionBarPinned]. */
@Composable
fun rememberActionBarPinned(gridState: LazyGridState): State<Boolean> {
    val statusBarPx = WindowInsets.statusBars.getTop(LocalDensity.current)
    return remember(gridState, statusBarPx) {
        derivedStateOf {
            val info = gridState.layoutInfo
            val bar = info.visibleItemsInfo.firstOrNull { it.key == ACTION_BAR_ITEM_KEY }
            if (bar == null) {
                gridState.firstVisibleItemIndex > 0
            } else {
                bar.offset.y < statusBarPx
            }
        }
    }
}

/**
 * The pinned copy of a screen's action bar, drawn over the list below the
 * status bar while [visible] (web `ActionBar` is `sticky top-0`).
 */
@Composable
fun PinnedActionBar(
    visible: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    AnimatedVisibility(visible = visible, enter = fadeIn(), exit = fadeOut(), modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background.copy(alpha = 0.92f))
                .statusBarsPadding(),
        ) {
            content()
        }
    }
}
