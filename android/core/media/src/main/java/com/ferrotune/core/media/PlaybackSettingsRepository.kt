package com.ferrotune.core.media

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.SetPreferenceRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Server-synced playback preferences (ReplayGain mode/offset, transcoding
 * enabled/bitrate) shared by the playback session starter and the settings
 * screen. Keys mirror the web client's `replayGainMode`, `replayGainOffset`,
 * `transcodingEnabled`, and `transcodingBitrate` preferences.
 */
@Singleton
class PlaybackSettingsRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val settingsApplier: PlaybackSettingsApplier,
) {
    private val _settings = MutableStateFlow(PlaybackSettings())
    val settings: StateFlow<PlaybackSettings> = _settings.asStateFlow()

    @Volatile
    private var loaded = false

    /** Best-effort settings for playback start; never throws. */
    suspend fun ensureLoaded(): PlaybackSettings {
        if (!loaded) {
            runCatching { load() }
        }
        return _settings.value
    }

    /** Loads the current account's preferences; callers can surface failures. */
    suspend fun load() {
        val prefs = apiProvider.requireApi().preferences().preferences
        apply(
            PlaybackSettings(
                replayGainMode = prefs.primitive("replayGainMode")?.contentOrNull
                    ?: DEFAULT_REPLAY_GAIN_MODE,
                replayGainOffset = prefs.primitive("replayGainOffset")?.floatOrNull
                    ?: DEFAULT_REPLAY_GAIN_OFFSET,
                transcodingEnabled = prefs.primitive("transcodingEnabled")?.booleanOrNull
                    ?: DEFAULT_TRANSCODING_ENABLED,
                transcodingBitrate = prefs.primitive("transcodingBitrate")?.intOrNull
                    ?: DEFAULT_TRANSCODING_BITRATE,
            ),
        )
        loaded = true
    }

    /** Drops the cache so the next [ensureLoaded] re-reads for a new account. */
    fun invalidate() {
        loaded = false
    }

    suspend fun setReplayGainMode(mode: String) {
        persist("replayGainMode", JsonPrimitive(mode)) { it.copy(replayGainMode = mode) }
    }

    suspend fun setReplayGainOffset(offsetDb: Float) {
        persist("replayGainOffset", JsonPrimitive(offsetDb)) {
            it.copy(replayGainOffset = offsetDb)
        }
    }

    suspend fun setTranscodingEnabled(enabled: Boolean) {
        persist("transcodingEnabled", JsonPrimitive(enabled)) {
            it.copy(transcodingEnabled = enabled)
        }
    }

    suspend fun setTranscodingBitrate(bitRateKbps: Int) {
        persist("transcodingBitrate", JsonPrimitive(bitRateKbps)) {
            it.copy(transcodingBitrate = bitRateKbps)
        }
    }

    private suspend fun persist(
        key: String,
        value: JsonElement,
        update: (PlaybackSettings) -> PlaybackSettings,
    ) {
        apiProvider.requireApi().setPreference(key, SetPreferenceRequest(value))
        apply(update(_settings.value))
    }

    private suspend fun apply(settings: PlaybackSettings) {
        _settings.update { settings }
        settingsApplier.applySettings(settings)
    }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive

    companion object {
        const val DEFAULT_REPLAY_GAIN_MODE = "computed"
        const val DEFAULT_REPLAY_GAIN_OFFSET = 0f
        const val DEFAULT_TRANSCODING_ENABLED = true
        const val DEFAULT_TRANSCODING_BITRATE = 192
        val REPLAY_GAIN_MODES = listOf("computed", "original", "disabled")
        val TRANSCODING_BITRATES = listOf(96, 128, 160, 192, 256, 320)
    }
}
