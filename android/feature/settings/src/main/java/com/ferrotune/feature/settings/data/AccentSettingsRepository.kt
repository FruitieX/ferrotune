package com.ferrotune.feature.settings.data

import com.ferrotune.core.designsystem.theme.AccentColors
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.UpdatePreferencesRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

data class AccentState(
    val name: String = AccentColors.DEFAULT,
    val custom: OklchColor = AccentColors.DEFAULT_CUSTOM,
) {
    val color: OklchColor get() = AccentColors.resolve(name, custom)
}

/**
 * Server-synced accent color preferences. The preset name lives in the
 * dedicated `accentColor` field; custom OKLCH values live in the generic
 * preference map, matching the web client.
 */
@Singleton
class AccentSettingsRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    private val _state = MutableStateFlow(AccentState())
    val state: StateFlow<AccentState> = _state.asStateFlow()

    @Volatile
    private var loaded = false

    suspend fun ensureLoaded(): AccentState {
        if (!loaded) {
            runCatching { load() }
        }
        return _state.value
    }

    suspend fun load() {
        val response = apiProvider.requireApi().preferences()
        val prefs = response.preferences
        _state.value = AccentState(
            name = response.accentColor.ifBlank { AccentColors.DEFAULT },
            custom = AccentColors.clampCustom(
                lightness = response.customAccentLightness
                    ?: prefs.primitive("custom-accent-lightness")?.doubleOrNull
                    ?: AccentColors.DEFAULT_CUSTOM_LIGHTNESS,
                chroma = response.customAccentChroma
                    ?: prefs.primitive("custom-accent-chroma")?.doubleOrNull
                    ?: AccentColors.DEFAULT_CUSTOM_CHROMA,
                hue = response.customAccentHue
                    ?: prefs.primitive("custom-accent-hue")?.doubleOrNull
                    ?: AccentColors.DEFAULT_CUSTOM_HUE,
            ),
        )
        loaded = true
    }

    fun invalidate() {
        loaded = false
    }

    suspend fun setPreset(name: String) {
        persist(_state.value.copy(name = name))
    }

    suspend fun setCustom(color: OklchColor) {
        persist(_state.value.copy(name = AccentColors.CUSTOM, custom = AccentColors.clampCustom(
            lightness = color.lightness,
            chroma = color.chroma,
            hue = color.hue,
        )))
    }

    private suspend fun persist(state: AccentState) {
        apiProvider.requireApi().updatePreferences(
            UpdatePreferencesRequest(
                accentColor = state.name,
                customAccentHue = state.custom.hue,
                customAccentLightness = state.custom.lightness,
                customAccentChroma = state.custom.chroma,
            ),
        )
        _state.update { state }
    }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive
}
