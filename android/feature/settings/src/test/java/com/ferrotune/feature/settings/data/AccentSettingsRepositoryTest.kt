package com.ferrotune.feature.settings.data

import com.ferrotune.core.designsystem.theme.AccentColors
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.UpdatePreferencesRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class AccentSettingsRepositoryTest {

    private class FakeAccentApi : FakeFerrotuneApi() {
        var accentColor: String = AccentColors.DEFAULT
        var customHue: Double? = null
        var customLightness: Double? = null
        var customChroma: Double? = null
        val preferenceValues = mutableMapOf<String, JsonElement>()

        override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
            accentColor = accentColor,
            customAccentHue = customHue,
            customAccentLightness = customLightness,
            customAccentChroma = customChroma,
            preferences = preferenceValues.toMap(),
        )

        override suspend fun updatePreferences(
            request: UpdatePreferencesRequest,
        ): PreferencesResponse {
            accentColor = request.accentColor
            customHue = request.customAccentHue
            customLightness = request.customAccentLightness
            customChroma = request.customAccentChroma
            return preferences()
        }
    }

    @Test
    fun `load reads preset and custom accent values`() = runTest {
        val api = FakeAccentApi().apply {
            accentColor = AccentColors.CUSTOM
            customHue = 200.0
            customLightness = 0.55
            customChroma = 0.12
        }
        val repository = AccentSettingsRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(AccentColors.CUSTOM, repository.state.value.name)
        assertEquals(OklchColor(0.55, 0.12, 200.0), repository.state.value.custom)
        assertEquals(OklchColor(0.55, 0.12, 200.0), repository.state.value.color)
    }

    @Test
    fun `setPreset persists the accent color`() = runTest {
        val api = FakeAccentApi()
        val repository = AccentSettingsRepository(FakeApiProvider(api))

        repository.setPreset("ocean")

        assertEquals("ocean", api.accentColor)
        assertEquals(AccentColors.resolve("ocean"), repository.state.value.color)
    }

    @Test
    fun `setCustom clamps values and switches to custom`() = runTest {
        val api = FakeAccentApi()
        val repository = AccentSettingsRepository(FakeApiProvider(api))

        repository.setCustom(OklchColor(lightness = 1.2, chroma = 0.4, hue = 380.0))

        assertEquals(AccentColors.CUSTOM, api.accentColor)
        assertEquals(0.9, api.customLightness!!, 0.0001)
        assertEquals(0.3, api.customChroma!!, 0.0001)
        assertEquals(20.0, api.customHue!!, 0.0001)
        assertEquals(AccentColors.CUSTOM, repository.state.value.name)
        assertNotNull(repository.state.value.color)
    }
}
