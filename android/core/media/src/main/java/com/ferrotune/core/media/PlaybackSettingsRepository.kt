package com.ferrotune.core.media

import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Playback preferences (ReplayGain mode/offset, transcoding enabled/bitrate,
 * progress bar style) shared by the playback session starter and the settings
 * screen, read from [ServerPreferences]. Keys mirror the web client's
 * `replayGainMode`, `replayGainOffset`, `transcodingEnabled`,
 * `transcodingBitrate`, and `progress-bar-style` preferences.
 */
@Singleton
class PlaybackSettingsRepository @Inject constructor(
    private val preferences: ServerPreferences,
    private val settingsApplier: PlaybackSettingsApplier,
) {
    val settings: StateFlow<PlaybackSettings> = preferences.snapshot.mapState { snapshot ->
        val prefs = snapshot.preferences
        PlaybackSettings(
            replayGainMode = prefs.primitive("replayGainMode")?.contentOrNull
                ?: DEFAULT_REPLAY_GAIN_MODE,
            replayGainOffset = prefs.primitive("replayGainOffset")?.floatOrNull
                ?: DEFAULT_REPLAY_GAIN_OFFSET,
            transcodingEnabled = prefs.primitive("transcodingEnabled")?.booleanOrNull
                ?: DEFAULT_TRANSCODING_ENABLED,
            transcodingBitrate = prefs.primitive("transcodingBitrate")?.intOrNull
                ?: DEFAULT_TRANSCODING_BITRATE,
            progressBarStyle = prefs.primitive("progress-bar-style")?.contentOrNull
                ?: DEFAULT_PROGRESS_BAR_STYLE,
        )
    }

    /** Best-effort settings for playback start; never throws. */
    suspend fun ensureLoaded(): PlaybackSettings {
        runCatching { preferences.ensureLoaded() }
        return applyCurrent()
    }

    /** Re-reads the server's preferences; callers can surface failures. */
    suspend fun load() {
        preferences.refresh()
        applyCurrent()
    }

    suspend fun setReplayGainMode(mode: String) {
        persist("replayGainMode", JsonPrimitive(mode))
    }

    suspend fun setReplayGainOffset(offsetDb: Float) {
        persist("replayGainOffset", JsonPrimitive(offsetDb))
    }

    suspend fun setTranscodingEnabled(enabled: Boolean) {
        persist("transcodingEnabled", JsonPrimitive(enabled))
    }

    suspend fun setTranscodingBitrate(bitRateKbps: Int) {
        persist("transcodingBitrate", JsonPrimitive(bitRateKbps))
    }

    suspend fun setProgressBarStyle(style: String) {
        persist("progress-bar-style", JsonPrimitive(style))
    }

    private suspend fun persist(key: String, value: JsonElement) {
        try {
            preferences.set(key, value)
        } finally {
            applyCurrent()
        }
    }

    private suspend fun applyCurrent(): PlaybackSettings =
        settings.value.also { settingsApplier.applySettings(it) }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive

    companion object {
        const val DEFAULT_REPLAY_GAIN_MODE = "computed"
        const val DEFAULT_REPLAY_GAIN_OFFSET = 0f
        const val DEFAULT_TRANSCODING_ENABLED = true
        const val DEFAULT_TRANSCODING_BITRATE = 192
        const val DEFAULT_PROGRESS_BAR_STYLE = "waveform"
        val REPLAY_GAIN_MODES = listOf("computed", "original", "disabled")
        val TRANSCODING_BITRATES = listOf(96, 128, 160, 192, 256, 320)
        val PROGRESS_BAR_STYLES = listOf("waveform", "simple")
    }
}
