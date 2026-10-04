package com.ferrotune.feature.home.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.PageIconHeader
import com.ferrotune.core.designsystem.components.SectionCard
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.StatTile
import com.ferrotune.core.designsystem.components.formatListeningTime
import com.ferrotune.core.network.generated.ListeningStats
import com.ferrotune.core.network.generated.ListeningStatsResponse
import java.text.DateFormat
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Web profile page: account details, listening activity (with the way into
 * the listening review), and sign out. Importing play counts/favorites and
 * managing raw history stay on desktop.
 */
@Composable
fun ProfileScreen(
    onBack: () -> Unit,
    onOpenReview: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var confirmSignOut by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize()) {
    // Sticky like the web header; the list scrolls beneath it, never under the status bar.
    PageIconHeader(
        icon = Icons.Filled.Person,
        title = state.user?.username ?: "Profile",
        subtitle = "Your account and listening activity",
        badge = if (state.user?.isAdmin == true) "Admin" else null,
        onBack = onBack,
        modifier = Modifier.background(MaterialTheme.colorScheme.background),
    )
    HorizontalDivider()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item(key = "account") { AccountCard(state) }
        item(key = "listening") { ListeningCard(state, onOpenReview) }
        item(key = "sign-out") {
            SectionCard(
                icon = Icons.AutoMirrored.Filled.Logout,
                title = "Sign Out",
                description = "Disconnect from the server and clear your session",
                accent = MaterialTheme.colorScheme.error,
            ) {
                Button(
                    onClick = { confirmSignOut = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Sign Out")
                }
            }
        }
    }
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out?") },
            text = { Text("You will be disconnected from the server and your playback queue will be cleared.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSignOut = false
                    onSignOut()
                }) {
                    Text("Sign Out", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun AccountCard(state: ProfileUiState) {
    SectionCard(icon = Icons.Filled.Person, title = "Account", description = "Your account details") {
        val user = state.user
        if (user == null && state.userLoading) {
            TileSkeletonRow()
            return@SectionCard
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile("Username", user?.username ?: "—", Icons.Filled.Person, Modifier.weight(1f))
            StatTile("Member since", formatMemberSince(user?.createdAt), Icons.Filled.CalendarMonth, Modifier.weight(1f))
        }
        user?.email?.takeIf { it.isNotBlank() }?.let { email ->
            StatTile("Email", email, Icons.Filled.Email, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ListeningCard(state: ProfileUiState, onOpenReview: () -> Unit) {
    SectionCard(
        icon = Icons.Filled.Headphones,
        title = "Listening Activity",
        description = "Your music listening statistics",
    ) {
        Button(onClick = onOpenReview, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.AutoMirrored.Filled.TrendingUp, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Your Review")
        }
        val listening = state.listening
        when {
            listening != null -> ListeningTiles(listening)
            state.listeningLoading -> {
                TileSkeletonRow()
                TileSkeletonRow()
            }
            else -> Text(
                state.listeningError ?: "No listening data yet. Start playing some music!",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ListeningTiles(listening: ListeningStatsResponse) {
    val numbers = NumberFormat.getIntegerInstance()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PeriodTile("Last 7 days", listening.last7Days, Icons.Filled.CalendarMonth, Modifier.weight(1f))
            PeriodTile("Last 30 days", listening.last30Days, Icons.Filled.CalendarMonth, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PeriodTile("This year", listening.thisYear, Icons.Filled.CalendarMonth, Modifier.weight(1f))
            PeriodTile("All time", listening.allTime, Icons.Filled.Schedule, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val all = listening.allTime
            StatTile("Plays", numbers.format(all.scrobbleCount), Icons.Filled.MusicNote, Modifier.weight(1f))
            StatTile("Skipped", numbers.format(all.skipCount), Icons.Filled.SkipNext, Modifier.weight(1f))
            StatTile(
                "Skip rate",
                "${skipRatePercent(all.skipCount, all.sessionCount)}%",
                Icons.AutoMirrored.Filled.TrendingUp,
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun PeriodTile(label: String, stats: ListeningStats, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) {
    StatTile(
        label = label,
        value = formatListeningTime(stats.totalSeconds),
        icon = icon,
        caption = "${stats.uniqueSongs} songs",
        modifier = modifier,
    )
}

@Composable
private fun TileSkeletonRow() {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ShimmerBox(Modifier.weight(1f).height(64.dp))
        ShimmerBox(Modifier.weight(1f).height(64.dp))
    }
}

/** The ISO timestamp's calendar date in the device's long date style (minSdk 24 has no java.time). */
internal fun formatMemberSince(createdAt: String?, locale: Locale = Locale.getDefault()): String {
    val day = createdAt?.takeIf { it.length >= 10 }?.substring(0, 10) ?: return "Unknown"
    val parser = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply { isLenient = false }
    val date = runCatching { parser.parse(day) }.getOrNull() ?: return "Unknown"
    return DateFormat.getDateInstance(DateFormat.LONG, locale).format(date)
}
