package com.ferrotune.feature.downloads.data

import com.ferrotune.core.media.DownloadEngine
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
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
 * Download preferences (format, bitrate, Wi-Fi only) read from
 * [ServerPreferences], mirroring the web client's
 * `downloadFormat`/`downloadBitrate`/`downloadWifiOnly` preference keys.
 */
@Singleton
class DownloadSettingsRepository @Inject constructor(
    private val preferences: ServerPreferences,
    private val engine: DownloadEngine,
) {
    val settings: StateFlow<DownloadSettings> = preferences.snapshot.mapState { snapshot ->
        val prefs = snapshot.preferences
        DownloadSettings(
            format = prefs.primitive("downloadFormat")?.contentOrNull
                ?: DownloadSettings.FORMAT_OPUS,
            bitRateKbps = prefs.primitive("downloadBitrate")?.intOrNull
                ?: DownloadSettings.DEFAULT_BIT_RATE_KBPS,
            wifiOnly = prefs.primitive("downloadWifiOnly")?.booleanOrNull ?: false,
        )
    }

    /** Best-effort; downloads fall back to the defaults when nothing is known. */
    suspend fun ensureLoaded() {
        runCatching { preferences.ensureLoaded() }
        engine.setWifiOnly(settings.value.wifiOnly)
    }

    /** Re-reads the server's preferences; callers can surface failures. */
    suspend fun load() {
        preferences.refresh()
        engine.setWifiOnly(settings.value.wifiOnly)
    }

    suspend fun setFormat(format: String) {
        preferences.set("downloadFormat", JsonPrimitive(format))
    }

    suspend fun setBitRate(bitRateKbps: Int) {
        preferences.set("downloadBitrate", JsonPrimitive(bitRateKbps))
    }

    suspend fun setWifiOnly(wifiOnly: Boolean) {
        try {
            preferences.set("downloadWifiOnly", JsonPrimitive(wifiOnly))
        } finally {
            engine.setWifiOnly(settings.value.wifiOnly)
        }
    }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive
}
