package com.ferrotune.feature.settings.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.ThemeModeStore
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.model.ThemeMode
import com.ferrotune.core.media.PlaybackSettings
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.feature.downloads.data.DownloadSettings
import com.ferrotune.feature.downloads.data.DownloadSettingsRepository
import com.ferrotune.feature.settings.data.AccentSettingsRepository
import com.ferrotune.feature.settings.data.AccentState
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val playbackSettingsRepository: PlaybackSettingsRepository,
    private val downloadSettingsRepository: DownloadSettingsRepository,
    private val accentSettingsRepository: AccentSettingsRepository,
    private val themeModeStore: ThemeModeStore,
) : ViewModel() {

    val playbackSettings: StateFlow<PlaybackSettings> = playbackSettingsRepository.settings
    val downloadSettings: StateFlow<DownloadSettings> = downloadSettingsRepository.settings
    val accent: StateFlow<AccentState> = accentSettingsRepository.state
    val themeMode: StateFlow<ThemeMode> = themeModeStore.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.SYSTEM)

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message

    init {
        viewModelScope.launch {
            runCatching { playbackSettingsRepository.load() }
                .onFailure { _message.value = "Could not load playback settings" }
        }
        viewModelScope.launch {
            runCatching { downloadSettingsRepository.load() }
                .onFailure { _message.value = "Could not load download settings" }
        }
        viewModelScope.launch {
            runCatching { accentSettingsRepository.load() }
                .onFailure { _message.value = "Could not load accent color" }
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { themeModeStore.setThemeMode(mode) }
    }

    fun setAccentPreset(name: String) {
        viewModelScope.launch { accentSettingsRepository.setPreset(name) }
    }

    fun setCustomAccent(lightness: Double, chroma: Double, hue: Double) {
        viewModelScope.launch {
            accentSettingsRepository.setCustom(OklchColor(lightness, chroma, hue))
        }
    }

    fun setReplayGainMode(mode: String) {
        viewModelScope.launch { playbackSettingsRepository.setReplayGainMode(mode) }
    }

    fun setReplayGainOffset(offsetDb: Float) {
        viewModelScope.launch { playbackSettingsRepository.setReplayGainOffset(offsetDb) }
    }

    fun setTranscodingEnabled(enabled: Boolean) {
        viewModelScope.launch { playbackSettingsRepository.setTranscodingEnabled(enabled) }
    }

    fun setTranscodingBitrate(bitRateKbps: Int) {
        viewModelScope.launch { playbackSettingsRepository.setTranscodingBitrate(bitRateKbps) }
    }

    fun setDownloadFormat(format: String) {
        viewModelScope.launch { downloadSettingsRepository.setFormat(format) }
    }

    fun setDownloadBitRate(bitRateKbps: Int) {
        viewModelScope.launch { downloadSettingsRepository.setBitRate(bitRateKbps) }
    }

    fun setDownloadWifiOnly(wifiOnly: Boolean) {
        viewModelScope.launch { downloadSettingsRepository.setWifiOnly(wifiOnly) }
    }

    fun dismissMessage() {
        _message.value = null
    }
}
