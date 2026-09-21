package com.ferrotune.feature.settings.ui

import com.ferrotune.core.media.DownloadInfo
import com.ferrotune.core.media.DownloadStateEventPayload
import com.ferrotune.core.media.PlaybackSettings
import com.ferrotune.core.media.PlaybackSettingsApplier
import com.ferrotune.core.media.PlaybackSettingsRepository
import com.ferrotune.core.media.DownloadEngine
import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.feature.downloads.data.DownloadSettings
import com.ferrotune.feature.downloads.data.DownloadSettingsRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeSettingsApi : FakeFerrotuneApi() {
        val preferenceValues = mutableMapOf<String, JsonElement>()

        override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
            accentColor = "rust",
            preferences = preferenceValues.toMap(),
        )

        override suspend fun setPreference(
            key: String,
            request: SetPreferenceRequest,
        ): GetPreferenceResponse {
            preferenceValues[key] = request.value
            return GetPreferenceResponse(key = key, value = request.value)
        }
    }

    private class FakeSettingsApplier : PlaybackSettingsApplier {
        val applied = mutableListOf<PlaybackSettings>()

        override suspend fun applySettings(settings: PlaybackSettings) {
            applied += settings
        }
    }

    private class NoopDownloadEngine : DownloadEngine {
        override val events: SharedFlow<DownloadStateEventPayload> = MutableSharedFlow()
        override fun initialize() = Unit
        override fun snapshot(): List<DownloadInfo> = emptyList()
        override fun enqueue(songId: String, format: String, maxBitRate: Int?) = Unit
        override fun cancel(songId: String) = Unit
        override fun pauseAll() = Unit
        override fun resumeAll() = Unit
        override fun removeAll() = Unit
        override fun setWifiOnly(wifiOnly: Boolean) = Unit
    }

    private class Harness(api: FakeSettingsApi = FakeSettingsApi()) {
        val api = api
        val applier = FakeSettingsApplier()
        val provider = FakeApiProvider(api)
        val viewModel = SettingsViewModel(
            PlaybackSettingsRepository(provider, applier),
            DownloadSettingsRepository(provider, NoopDownloadEngine()),
        )
    }

    @Test
    fun `loads playback and download preferences on init`() = runTest {
        val harness = Harness(
            FakeSettingsApi().apply {
                preferenceValues["replayGainMode"] = JsonPrimitive("original")
                preferenceValues["replayGainOffset"] = JsonPrimitive(-3.5)
                preferenceValues["transcodingEnabled"] = JsonPrimitive(false)
                preferenceValues["transcodingBitrate"] = JsonPrimitive(256)
                preferenceValues["downloadFormat"] = JsonPrimitive("original")
                preferenceValues["downloadWifiOnly"] = JsonPrimitive(true)
            },
        )

        val playback = harness.viewModel.playbackSettings.value
        assertEquals("original", playback.replayGainMode)
        assertEquals(-3.5f, playback.replayGainOffset)
        assertEquals(false, playback.transcodingEnabled)
        assertEquals(256, playback.transcodingBitrate)
        assertEquals(DownloadSettings.FORMAT_ORIGINAL, harness.viewModel.downloadSettings.value.format)
        assertTrue(harness.viewModel.downloadSettings.value.wifiOnly)
    }

    @Test
    fun `playback setters persist preferences and apply to the engine`() = runTest {
        val harness = Harness()

        harness.viewModel.setReplayGainMode("disabled")
        harness.viewModel.setReplayGainOffset(2.5f)
        harness.viewModel.setTranscodingEnabled(false)
        harness.viewModel.setTranscodingBitrate(96)

        assertEquals(JsonPrimitive("disabled"), harness.api.preferenceValues["replayGainMode"])
        assertEquals(JsonPrimitive(2.5f), harness.api.preferenceValues["replayGainOffset"])
        assertEquals(JsonPrimitive(false), harness.api.preferenceValues["transcodingEnabled"])
        assertEquals(JsonPrimitive(96), harness.api.preferenceValues["transcodingBitrate"])
        assertEquals(2.5f, harness.viewModel.playbackSettings.value.replayGainOffset)
        assertEquals(5, harness.applier.applied.size)
        assertEquals("disabled", harness.applier.applied[1].replayGainMode)
        assertEquals(96, harness.applier.applied.last().transcodingBitrate)
    }

    @Test
    fun `download setters persist preferences`() = runTest {
        val harness = Harness()

        harness.viewModel.setDownloadFormat(DownloadSettings.FORMAT_OPUS)
        harness.viewModel.setDownloadBitRate(192)
        harness.viewModel.setDownloadWifiOnly(true)

        assertEquals(JsonPrimitive("opus"), harness.api.preferenceValues["downloadFormat"])
        assertEquals(JsonPrimitive(192), harness.api.preferenceValues["downloadBitrate"])
        assertEquals(JsonPrimitive(true), harness.api.preferenceValues["downloadWifiOnly"])
        assertEquals(192, harness.viewModel.downloadSettings.value.bitRateKbps)
    }
}
