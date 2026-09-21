package com.ferrotune.feature.settings.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.media.PlaybackSettings
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.feature.downloads.data.DownloadSettings
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(
    accountLabel: String?,
    serverUrl: String?,
    username: String?,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val playback by viewModel.playbackSettings.collectAsStateWithLifecycle()
    val downloads by viewModel.downloadSettings.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissMessage()
        }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            item {
                SectionHeader("Account")
                ListItem(
                    headlineContent = { Text(accountLabel ?: "Not signed in") },
                    supportingContent = {
                        Text(listOfNotNull(serverUrl, username).joinToString(" · "))
                    },
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Button(onClick = onSignOut) { Text("Sign out") }
                }
            }

            item {
                HorizontalDivider()
                SectionHeader("Playback")
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
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text("Pre-amp offset: ${playback.replayGainOffset.roundToInt()} dB")
                        Slider(
                            value = playback.replayGainOffset,
                            onValueChange = viewModel::setReplayGainOffset,
                            valueRange = -12f..12f,
                            steps = 23,
                        )
                    }
                }
                ListItem(
                    headlineContent = { Text("Transcoding") },
                    supportingContent = { Text("Stream as Opus with embedded ReplayGain tags") },
                    trailingContent = {
                        Switch(
                            checked = playback.transcodingEnabled,
                            onCheckedChange = viewModel::setTranscodingEnabled,
                        )
                    },
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
            }

            item {
                HorizontalDivider()
                SectionHeader("Downloads")
                ChoiceRow(
                    label = "Format",
                    options = listOf(
                        DownloadSettings.FORMAT_OPUS,
                        DownloadSettings.FORMAT_ORIGINAL,
                    ),
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
                ListItem(
                    headlineContent = { Text("Wi-Fi only") },
                    supportingContent = { Text("Wait for Wi-Fi before downloading") },
                    trailingContent = {
                        Switch(
                            checked = downloads.wifiOnly,
                            onCheckedChange = viewModel::setDownloadWifiOnly,
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun <T> ChoiceRow(
    label: String,
    options: List<T>,
    selected: T,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(top = 4.dp),
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
