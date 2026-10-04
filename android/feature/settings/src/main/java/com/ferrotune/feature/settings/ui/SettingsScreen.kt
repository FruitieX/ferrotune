package com.ferrotune.feature.settings.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.PageIconHeader
import com.ferrotune.core.designsystem.components.SectionCard
import com.ferrotune.core.designsystem.components.StatTile
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.theme.AccentColors
import com.ferrotune.core.designsystem.theme.oklchToColor
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.model.Account
import com.ferrotune.core.model.ThemeMode
import com.ferrotune.feature.downloads.data.DownloadSettings
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Web settings jump-nav sections, in page order. */
private enum class SettingsSection(val label: String, val icon: ImageVector) {
    CONNECTION("Connection", Icons.Filled.Storage),
    LIBRARY("Library", Icons.Filled.BarChart),
    HOME("Home", Icons.Filled.ViewAgenda),
    PLAYBACK("Playback", Icons.Filled.MusicNote),
    DOWNLOADS("Downloads", Icons.Filled.Download),
    APPEARANCE("Appearance", Icons.Filled.Palette),
    ABOUT("About", Icons.Filled.Info),
}

/**
 * Web Settings page: an icon header, a row of section chips that jump to
 * each card, and cards for the server connection and accounts, library
 * statistics, home layout, playback, downloads, appearance, and about.
 */
@Composable
fun SettingsScreen(
    accountLabel: String?,
    serverUrl: String?,
    username: String?,
    accounts: List<Account>,
    activeAccountId: String?,
    onSwitchAccount: (String) -> Unit,
    onAddAccount: () -> Unit,
    onOpenHomeLayout: () -> Unit,
    onOpenDownloads: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val playback by viewModel.playbackSettings.collectAsStateWithLifecycle()
    val downloads by viewModel.downloadSettings.collectAsStateWithLifecycle()
    val accent by viewModel.accent.collectAsStateWithLifecycle()
    val themeMode by viewModel.themeMode.collectAsStateWithLifecycle()
    val stats by viewModel.libraryStats.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    Column(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background),
        ) {
            PageIconHeader(
                icon = Icons.Filled.Settings,
                title = "Settings",
                subtitle = "Manage your preferences",
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                SettingsSection.entries.forEach { section ->
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { scope.launch { listState.animateScrollToItem(section.ordinal) } }
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            section.icon,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            section.label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item(key = SettingsSection.CONNECTION) {
                SectionCard(
                    icon = Icons.Filled.Storage,
                    title = "Server Connection",
                    description = "Your Ferrotune server connection details",
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            if (isOnline) Icons.Filled.CheckCircle else Icons.Outlined.CloudOff,
                            contentDescription = null,
                            tint = if (isOnline) Color(0xFF22C55E) else MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(28.dp),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(if (isOnline) "Connected" else "Offline", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Text(
                                serverUrl.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatTile(label = "Username", value = username.orEmpty(), icon = Icons.Filled.Person, modifier = Modifier.weight(1f))
                        StatTile(label = "Account", value = accountLabel.orEmpty(), icon = Icons.Filled.PhoneAndroid, modifier = Modifier.weight(1f))
                    }
                    val others = accounts.filter { it.id != activeAccountId }
                    if (others.isNotEmpty()) {
                        Text(
                            "Other accounts",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        others.forEach { account ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onSwitchAccount(account.id) }
                                    .padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(account.label, style = MaterialTheme.typography.bodyMedium)
                                    Text(
                                        account.serverUrl,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text("Switch", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onAddAccount) {
                            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Add account", modifier = Modifier.padding(start = 6.dp))
                        }
                        OutlinedButton(onClick = onSignOut) {
                            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                            Text("Sign out", modifier = Modifier.padding(start = 6.dp))
                        }
                    }
                }
            }

            item(key = SettingsSection.LIBRARY) {
                SectionCard(
                    icon = Icons.Filled.BarChart,
                    title = "Library Statistics",
                    description = "Overview of your music library",
                ) {
                    val s = stats.stats
                    if (s == null) {
                        Text(
                            when {
                                !isOnline -> "Statistics are unavailable offline."
                                stats.failed -> "Couldn't load statistics."
                                else -> "Loading…"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatTile("Songs", s.songCount.toString(), Icons.Filled.MusicNote, Modifier.weight(1f))
                            StatTile("Albums", s.albumCount.toString(), Icons.Filled.ViewAgenda, Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatTile("Artists", s.artistCount.toString(), Icons.Filled.Person, Modifier.weight(1f))
                            StatTile("Playtime", formatTotalDuration(s.totalDurationSeconds), Icons.Filled.BarChart, Modifier.weight(1f))
                        }
                    }
                }
            }

            item(key = SettingsSection.HOME) {
                SectionCard(
                    icon = Icons.Filled.ViewAgenda,
                    title = "Home",
                    description = "Quick tiles and sections on the Home page",
                ) {
                    NavigationRow(
                        title = "Home layout",
                        subtitle = "Customize Home tiles and sections",
                        onClick = onOpenHomeLayout,
                    )
                }
            }

            item(key = SettingsSection.PLAYBACK) {
                SectionCard(
                    icon = Icons.Filled.MusicNote,
                    title = "Playback",
                    description = "Volume normalization, streaming quality, and the seek bar",
                ) {
                    ChoiceRow(
                        label = "ReplayGain",
                        options = PlaybackSettingsRepository.REPLAY_GAIN_MODES,
                        selected = playback.replayGainMode,
                        optionLabel = { mode ->
                            when (mode) {
                                "computed" -> "Computed"
                                "original" -> "Original"
                                else -> "Disabled"
                            }
                        },
                        onSelect = viewModel::setReplayGainMode,
                    )
                    if (playback.replayGainMode != "disabled") {
                        Column {
                            Text(
                                "Pre-amp offset: ${playback.replayGainOffset.roundToInt()} dB",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Slider(
                                value = playback.replayGainOffset,
                                onValueChange = viewModel::setReplayGainOffset,
                                valueRange = -12f..12f,
                                steps = 23,
                            )
                        }
                    }
                    SwitchRow(
                        title = "Transcoding",
                        subtitle = "Stream as Opus with embedded ReplayGain tags",
                        checked = playback.transcodingEnabled,
                        onCheckedChange = viewModel::setTranscodingEnabled,
                    )
                    if (playback.transcodingEnabled) {
                        ChoiceRow(
                            label = "Transcoding bitrate",
                            options = PlaybackSettingsRepository.TRANSCODING_BITRATES,
                            selected = playback.transcodingBitrate,
                            optionLabel = { "$it kbps" },
                            onSelect = viewModel::setTranscodingBitrate,
                        )
                    }
                    ChoiceRow(
                        label = "Progress bar",
                        options = PlaybackSettingsRepository.PROGRESS_BAR_STYLES,
                        selected = playback.progressBarStyle,
                        optionLabel = { style -> if (style == "waveform") "Waveform" else "Simple" },
                        onSelect = viewModel::setProgressBarStyle,
                    )
                }
            }

            item(key = SettingsSection.DOWNLOADS) {
                SectionCard(
                    icon = Icons.Filled.Download,
                    title = "Downloads",
                    description = "Offline copies for listening without a connection",
                ) {
                    ChoiceRow(
                        label = "Format",
                        options = listOf(DownloadSettings.FORMAT_OPUS, DownloadSettings.FORMAT_ORIGINAL),
                        selected = downloads.format,
                        optionLabel = { if (it == DownloadSettings.FORMAT_OPUS) "Opus" else "Original" },
                        onSelect = viewModel::setDownloadFormat,
                    )
                    if (downloads.format == DownloadSettings.FORMAT_OPUS) {
                        ChoiceRow(
                            label = "Download bitrate",
                            options = DownloadSettings.BIT_RATES,
                            selected = downloads.bitRateKbps,
                            optionLabel = { "$it kbps" },
                            onSelect = viewModel::setDownloadBitRate,
                        )
                    }
                    SwitchRow(
                        title = "Wi-Fi only",
                        subtitle = "Wait for Wi-Fi before downloading",
                        checked = downloads.wifiOnly,
                        onCheckedChange = viewModel::setDownloadWifiOnly,
                    )
                    NavigationRow(
                        title = "Downloaded music",
                        subtitle = "Manage downloads and free up space",
                        onClick = onOpenDownloads,
                    )
                }
            }

            item(key = SettingsSection.APPEARANCE) {
                SectionCard(
                    icon = Icons.Filled.Palette,
                    title = "Appearance",
                    description = "Theme and accent color",
                ) {
                    Text("Theme", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ThemeButton("Light", Icons.Filled.LightMode, themeMode == ThemeMode.LIGHT) {
                            viewModel.setThemeMode(ThemeMode.LIGHT)
                        }
                        ThemeButton("Dark", Icons.Filled.DarkMode, themeMode == ThemeMode.DARK) {
                            viewModel.setThemeMode(ThemeMode.DARK)
                        }
                        ThemeButton("System", Icons.Filled.PhoneAndroid, themeMode == ThemeMode.SYSTEM) {
                            viewModel.setThemeMode(ThemeMode.SYSTEM)
                        }
                    }
                    Text("Accent color", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    AccentPicker(selected = accent.name, onSelectPreset = viewModel::setAccentPreset)
                    if (accent.name == AccentColors.CUSTOM) {
                        // Drags edit a local draft; the server write happens on release.
                        var draft by remember(accent.custom) { mutableStateOf(accent.custom) }
                        val commit = { viewModel.setCustomAccent(draft.lightness, draft.chroma, draft.hue) }
                        Column {
                            Text("Hue: ${draft.hue.roundToInt()}°", style = MaterialTheme.typography.bodyMedium)
                            Slider(
                                value = draft.hue.toFloat(),
                                onValueChange = { draft = draft.copy(hue = it.toDouble()) },
                                onValueChangeFinished = commit,
                                valueRange = 0f..360f,
                            )
                            Text("Lightness: ${draft.lightness.format(2)}", style = MaterialTheme.typography.bodyMedium)
                            Slider(
                                value = draft.lightness.toFloat(),
                                onValueChange = { draft = draft.copy(lightness = it.toDouble()) },
                                onValueChangeFinished = commit,
                                valueRange = 0.3f..0.9f,
                            )
                            Text("Chroma: ${draft.chroma.format(2)}", style = MaterialTheme.typography.bodyMedium)
                            Slider(
                                value = draft.chroma.toFloat(),
                                onValueChange = { draft = draft.copy(chroma = it.toDouble()) },
                                onValueChangeFinished = commit,
                                valueRange = 0.01f..0.3f,
                            )
                        }
                    }
                }
            }

            item(key = SettingsSection.ABOUT) {
                SectionCard(icon = Icons.Filled.Info, title = "About Ferrotune", description = null) {
                    Text(
                        "Ferrotune for Android (native) — a self-hosted music server and client.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun NavigationRow(title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SwitchRow(title: String, subtitle: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

/** Web theme buttons: outlined, filled with the accent when selected. */
@Composable
private fun ThemeButton(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick, contentPadding = PaddingValues(horizontal = 12.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
            Text(label, modifier = Modifier.padding(start = 6.dp))
        }
    } else {
        OutlinedButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 12.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
            Text(label, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccentPicker(
    selected: String,
    onSelectPreset: (String) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        AccentColors.PRESETS.forEach { preset ->
            val color = oklchToColor(preset.color)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(color)
                        .clickable { onSelectPreset(preset.name) },
                ) {
                    if (selected == preset.name) {
                        Icon(
                            imageVector = Icons.Filled.Check,
                            contentDescription = preset.label,
                            tint = if (AccentColors.needsDarkForeground(preset.color.lightness)) {
                                Color.Black
                            } else {
                                Color.White
                            },
                        )
                    }
                }
                Text(
                    text = preset.label,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        val customSelected = selected == AccentColors.CUSTOM
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable { onSelectPreset(AccentColors.CUSTOM) },
            ) {
                Icon(
                    imageVector = Icons.Filled.Palette,
                    contentDescription = "Custom",
                    tint = if (customSelected) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Text(
                text = "Custom",
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

private fun Double.format(decimals: Int): String = "%.${decimals}f".format(this)

@Composable
private fun <T> ChoiceRow(
    label: String,
    options: List<T>,
    selected: T,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
) {
    Column {
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .padding(top = 4.dp)
                .horizontalScroll(rememberScrollState()),
        ) {
            options.forEach { option ->
                FilterChip(
                    selected = option == selected,
                    onClick = { onSelect(option) },
                    label = { Text(optionLabel(option)) },
                )
            }
        }
    }
}
