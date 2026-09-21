package com.ferrotune.feature.downloads.data

import com.ferrotune.core.testing.FakeApiProvider
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadSettingsRepositoryTest {

    private fun repository(
        api: FakeDownloadApi = FakeDownloadApi(),
        engine: FakeDownloadEngine = FakeDownloadEngine(),
    ) = DownloadSettingsRepository(FakeApiProvider(api), engine)

    @Test
    fun `load reads server preferences and applies wifi only to the engine`() = runTest {
        val api = FakeDownloadApi().apply {
            preferenceValues["downloadFormat"] = JsonPrimitive("original")
            preferenceValues["downloadBitrate"] = JsonPrimitive(192)
            preferenceValues["downloadWifiOnly"] = JsonPrimitive(true)
        }
        val engine = FakeDownloadEngine()
        val repository = repository(api, engine)

        repository.load()

        assertEquals(DownloadSettings.FORMAT_ORIGINAL, repository.settings.value.format)
        assertEquals(192, repository.settings.value.bitRateKbps)
        assertTrue(repository.settings.value.wifiOnly)
        assertEquals(true, engine.wifiOnly)
        assertNull(repository.settings.value.maxBitRate)
    }

    @Test
    fun `missing preferences fall back to opus 128 without wifi restriction`() = runTest {
        val repository = repository()

        repository.load()

        assertEquals(DownloadSettings.FORMAT_OPUS, repository.settings.value.format)
        assertEquals(128, repository.settings.value.bitRateKbps)
        assertEquals(false, repository.settings.value.wifiOnly)
        assertEquals(128, repository.settings.value.maxBitRate)
    }

    @Test
    fun `setters persist preferences and update local state`() = runTest {
        val api = FakeDownloadApi()
        val engine = FakeDownloadEngine()
        val repository = repository(api, engine)
        repository.load()

        repository.setFormat(DownloadSettings.FORMAT_ORIGINAL)
        repository.setBitRate(256)
        repository.setWifiOnly(true)

        assertEquals(JsonPrimitive("original"), api.preferenceValues["downloadFormat"])
        assertEquals(JsonPrimitive(256), api.preferenceValues["downloadBitrate"])
        assertEquals(JsonPrimitive(true), api.preferenceValues["downloadWifiOnly"])
        assertEquals(DownloadSettings.FORMAT_ORIGINAL, repository.settings.value.format)
        assertEquals(256, repository.settings.value.bitRateKbps)
        assertEquals(true, repository.settings.value.wifiOnly)
        assertEquals(true, engine.wifiOnly)
    }
}
