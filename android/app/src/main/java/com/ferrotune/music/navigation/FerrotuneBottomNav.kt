package com.ferrotune.music.navigation

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars

/** Bottom navigation destinations, ordered like the web client's `MobileNav`. */
enum class BottomNavDestination(
    val label: String,
    val icon: ImageVector,
) {
    HOME("Home", Icons.Filled.Home),
    SEARCH("Search", Icons.Filled.Search),
    LIBRARY("Library", Icons.Filled.LibraryMusic),
    PLAYLISTS("Playlists", Icons.Filled.QueueMusic),
    SETTINGS("Settings", Icons.Filled.Person),
}

/**
 * Web-matching bottom navigation: 64dp row, 10sp labels, primary-tinted active
 * item, and a 48x2dp indicator pill that springs between items. The bar
 * background extends behind the system navigation bar.
 */
@Composable
fun FerrotuneBottomNav(
    selected: BottomNavDestination?,
    onSelect: (BottomNavDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val destinations = BottomNavDestination.entries

    Surface(
        color = MaterialTheme.colorScheme.background.copy(alpha = 0.95f),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                val itemWidth = maxWidth / destinations.size
                val selectedIndex = selected?.ordinal ?: 0
                val indicatorOffset by animateDpAsState(
                    targetValue = itemWidth * selectedIndex + itemWidth / 2 - 24.dp,
                    animationSpec = spring(
                        dampingRatio = 0.8f,
                        stiffness = Spring.StiffnessMediumLow,
                    ),
                    label = "nav-indicator",
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(64.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    destinations.forEach { destination ->
                        BottomNavItem(
                            destination = destination,
                            selected = destination == selected,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSelect(destination)
                            },
                        )
                    }
                }

                if (selected != null) {
                    Box(
                        modifier = Modifier
                            .offset(x = indicatorOffset)
                            .padding(top = 1.dp)
                            .width(48.dp)
                            .height(2.dp)
                            .background(MaterialTheme.colorScheme.primary, CircleShape),
                    )
                }
            }
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        }
    }
}

@Composable
private fun BottomNavItem(
    destination: BottomNavDestination,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(
        modifier = modifier
            .height(64.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = destination.icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = destination.label,
            color = color,
            fontSize = 10.sp,
            lineHeight = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}
