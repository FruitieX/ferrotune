package com.ferrotune.feature.settings.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.datastore.ThemeModeStore
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.media.PlaybackSettings
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.model.ThemeMode
import com.ferrotune.core.network.ConnectivityMonitor
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.generated.StatsResponse
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

/** Library Statistics card: null counts while loading, or [failed] when unavailable. */
data class LibraryStatsState(
    val stats: StatsResponse? = null,
    val failed: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val playbackSettingsRepository: PlaybackSettingsRepository,
    private val downloadSettingsRepository: DownloadSettingsRepository,
    private val accentSettingsRepository: AccentSettingsRepository,
    private val serverPreferences: ServerPreferences,
    private val themeModeStore: ThemeModeStore,
    private val apiProvider: FerrotuneApiProvider,
    private val messages: UserMessages,
    connectivity: ConnectivityMonitor,
) : ViewModel() {

    val playbackSettings: StateFlow<PlaybackSettings> = playbackSettingsRepository.settings
    val applySearchTermsToQueue: StateFlow<Boolean> = playbackSettingsRepository.applySearchTermsToQueue
    val downloadSettings: StateFlow<DownloadSettings> = downloadSettingsRepository.settings
    val accent: StateFlow<AccentState> = accentSettingsRepository.state
    val themeMode: StateFlow<ThemeMode> = themeModeStore.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.DEFAULT)
    val isOnline: StateFlow<Boolean> = connectivity.isOnline

    private val _libraryStats = MutableStateFlow(LibraryStatsState())

    /** Web "Library Statistics" card counts. */
    val libraryStats: StateFlow<LibraryStatsState> = _libraryStats

    init {
        viewModelScope.launch {
            // One read for every card; cached values stay on screen when it fails.
            runCatching { serverPreferences.refresh() }
                .onFailure {
                    if (serverPreferences.snapshot.value == ServerPreferences.EMPTY) {
                        messages.failure("Couldn't load your settings", it)
                    }
                }
            playbackSettingsRepository.ensureLoaded()
            downloadSettingsRepository.ensureLoaded()
        }
        viewModelScope.launch {
            connectivity.isOnline.collect { online ->
                if (online && _libraryStats.value.stats == null) loadStats()
            }
        }
    }

    private suspend fun loadStats() {
        _libraryStats.value = LibraryStatsState()
        _libraryStats.value = runCatching { apiCall { apiProvider.requireApi().stats() } }
            .fold(
                onSuccess = { LibraryStatsState(stats = it) },
                onFailure = { LibraryStatsState(failed = true) },
            )
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { themeModeStore.setThemeMode(mode) }
    }

    fun setAccentPreset(name: String) {
        save("Couldn't change the accent color") { accentSettingsRepository.setPreset(name) }
    }

    fun setCustomAccent(lightness: Double, chroma: Double, hue: Double) {
        save("Couldn't change the accent color") {
            accentSettingsRepository.setCustom(OklchColor(lightness, chroma, hue))
        }
    }

    fun setReplayGainMode(mode: String) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setReplayGainMode(mode) }
    }

    fun setReplayGainOffset(offsetDb: Float) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setReplayGainOffset(offsetDb) }
    }

    fun setApplySearchTermsToQueue(apply: Boolean) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setApplySearchTermsToQueue(apply) }
    }

    fun setTranscodingEnabled(enabled: Boolean) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setTranscodingEnabled(enabled) }
    }

    fun setTranscodingBitrate(bitRateKbps: Int) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setTranscodingBitrate(bitRateKbps) }
    }

    fun setProgressBarStyle(style: String) {
        save(PLAYBACK_FAILURE) { playbackSettingsRepository.setProgressBarStyle(style) }
    }

    fun setDownloadFormat(format: String) {
        save(DOWNLOAD_FAILURE) { downloadSettingsRepository.setFormat(format) }
    }

    fun setDownloadBitRate(bitRateKbps: Int) {
        save(DOWNLOAD_FAILURE) { downloadSettingsRepository.setBitRate(bitRateKbps) }
    }

    fun setDownloadWifiOnly(wifiOnly: Boolean) {
        save(DOWNLOAD_FAILURE) { downloadSettingsRepository.setWifiOnly(wifiOnly) }
    }

    /** Writes roll back on failure, so the controls snap back and a message explains why. */
    private fun save(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { messages.failure(failure, it) }
        }
    }

    private companion object {
        const val PLAYBACK_FAILURE = "Couldn't save the playback setting"
        const val DOWNLOAD_FAILURE = "Couldn't save the download setting"
    }
}
