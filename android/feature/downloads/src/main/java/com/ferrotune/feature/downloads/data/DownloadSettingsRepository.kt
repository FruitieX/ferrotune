package com.ferrotune.feature.downloads.data

import com.ferrotune.core.media.DownloadEngine
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.AccountScopedPreferences
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
import kotlinx.serialization.json.intOrNull

data class DownloadSettings(
    val format: String = FORMAT_OPUS,
    val bitRateKbps: Int = DEFAULT_BIT_RATE_KBPS,
    val wifiOnly: Boolean = false,
) {
    val maxBitRate: Int? get() = if (format == FORMAT_OPUS) bitRateKbps else null

    companion object {
        const val FORMAT_OPUS = "opus"
        const val FORMAT_ORIGINAL = "original"
        const val DEFAULT_BIT_RATE_KBPS = 128
        val BIT_RATES = listOf(128, 192, 256)
    }
}

/**
 * Server-synced download preferences (format, bitrate, Wi-Fi only), mirroring
 * the web client's `downloadFormat`/`downloadBitrate`/`downloadWifiOnly`
 * preference keys.
 */
@Singleton
class DownloadSettingsRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val engine: DownloadEngine,
) : AccountScopedPreferences {
    private val _settings = MutableStateFlow(DownloadSettings())
    val settings: StateFlow<DownloadSettings> = _settings.asStateFlow()

    @Volatile
    private var loaded = false

    suspend fun ensureLoaded() {
        if (loaded) return
        load()
    }

    suspend fun load() {
        val prefs = apiProvider.requireApi().preferences().preferences
        val settings = DownloadSettings(
            format = prefs.primitive("downloadFormat")?.contentOrNull
                ?: DownloadSettings.FORMAT_OPUS,
            bitRateKbps = prefs.primitive("downloadBitrate")?.intOrNull
                ?: DownloadSettings.DEFAULT_BIT_RATE_KBPS,
            wifiOnly = prefs.primitive("downloadWifiOnly")?.booleanOrNull ?: false,
        )
        _settings.value = settings
        engine.setWifiOnly(settings.wifiOnly)
        loaded = true
    }

    suspend fun setFormat(format: String) {
        persist("downloadFormat", JsonPrimitive(format)) { it.copy(format = format) }
    }

    suspend fun setBitRate(bitRateKbps: Int) {
        persist("downloadBitrate", JsonPrimitive(bitRateKbps)) {
            it.copy(bitRateKbps = bitRateKbps)
        }
    }

    suspend fun setWifiOnly(wifiOnly: Boolean) {
        engine.setWifiOnly(wifiOnly)
        persist("downloadWifiOnly", JsonPrimitive(wifiOnly)) { it.copy(wifiOnly = wifiOnly) }
    }

    override fun invalidate() {
        loaded = false
    }

    private suspend fun persist(
        key: String,
        value: JsonElement,
        update: (DownloadSettings) -> DownloadSettings,
    ) {
        apiProvider.requireApi().setPreference(key, SetPreferenceRequest(value))
        _settings.update(update)
    }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive
}
