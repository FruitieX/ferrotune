package com.ferrotune.core.designsystem.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** One tappable row in a [MediaActionSheet]. */
data class MediaAction(
    val label: String,
    val icon: ImageVector,
    /** Draws a web-style separator above this row to start a new group. */
    val separatorBefore: Boolean = false,
    val destructive: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * Closes the enclosing [MediaActionSheet] with its slide-out animation. Rows
 * contributed by other modules through `extraContent` use it via
 * [MediaActionRow], so every action closes the sheet the same way.
 */
val LocalMediaSheetDismiss = staticCompositionLocalOf<(() -> Unit)?> { null }

/**
 * Web-style bottom action sheet for media item actions (the touch variant of
 * the web client's `DrawerMenu`): an optional artwork/title header followed
 * by action rows. Content scrolls when it is taller than the screen, and
 * picking an action slides the sheet away instead of cutting it off.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaActionSheet(
    expanded: Boolean,
    onDismiss: () -> Unit,
    actions: List<MediaAction>,
    modifier: Modifier = Modifier,
    title: String? = null,
    subtitle: String? = null,
    coverModel: Any? = null,
    seed: String? = null,
    circularCover: Boolean = false,
    placeholder: ImageVector = Icons.Filled.MusicNote,
    headerContent: (@Composable () -> Unit)? = null,
    extraContent: (@Composable () -> Unit)? = null,
) {
    if (!expanded) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val dismiss: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            if (!sheetState.isVisible) onDismiss()
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = modifier,
    ) {
        CompositionLocalProvider(LocalMediaSheetDismiss provides dismiss) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 12.dp),
            ) {
                if (title != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CoverArt(
                            model = coverModel,
                            contentDescription = null,
                            seed = seed ?: title,
                            shape = if (circularCover) CircleShape else RoundedCornerShape(6.dp),
                            placeholder = placeholder,
                            modifier = Modifier.size(48.dp),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = title,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!subtitle.isNullOrBlank()) {
                                Text(
                                    text = subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    HorizontalDivider(
                        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
                headerContent?.invoke()
                actions.forEach { action ->
                    if (action.separatorBefore) MediaActionSeparator()
                    MediaActionRow(
                        icon = action.icon,
                        label = action.label,
                        destructive = action.destructive,
                        onClick = action.onClick,
                    )
                }
                extraContent?.invoke()
            }
        }
    }
}

/** Web `DropdownMenuSeparator` inside a [MediaActionSheet]. */
@Composable
fun MediaActionSeparator() {
    HorizontalDivider(
        modifier = Modifier.padding(vertical = 4.dp),
        color = MaterialTheme.colorScheme.outline,
    )
}

/**
 * Single tappable row inside a [MediaActionSheet]. Inside a sheet it closes
 * the sheet before running [onClick].
 */
@Composable
fun MediaActionRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    destructive: Boolean = false,
    closesSheet: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    val dismiss = LocalMediaSheetDismiss.current
    val tint = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable {
                if (closesSheet) dismiss?.invoke()
                onClick()
            }
            .padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (destructive) tint else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (destructive) tint else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        trailing?.invoke()
    }
}
