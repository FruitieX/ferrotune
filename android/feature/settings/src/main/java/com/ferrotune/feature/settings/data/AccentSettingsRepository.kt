package com.ferrotune.feature.settings.data

import com.ferrotune.core.designsystem.theme.AccentColors
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

data class AccentState(
    val name: String = AccentColors.DEFAULT,
    val custom: OklchColor = AccentColors.DEFAULT_CUSTOM,
) {
    val color: OklchColor get() = AccentColors.resolve(name, custom)
}

/**
 * Accent color preferences read from [ServerPreferences]. The preset name
 * lives in the dedicated `accentColor` field; custom OKLCH values live in the
 * dedicated fields, falling back to the generic preference map like the web
 * client.
 */
@Singleton
class AccentSettingsRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val state: StateFlow<AccentState> = preferences.snapshot.mapState { response ->
        val prefs = response.preferences
        AccentState(
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
    }

    /** Best-effort; never throws. */
    suspend fun ensureLoaded(): AccentState {
        runCatching { preferences.ensureLoaded() }
        return state.value
    }

    /** Re-reads the server's preferences; callers can surface failures. */
    suspend fun load() {
        preferences.refresh()
    }

    suspend fun setPreset(name: String) {
        persist(state.value.copy(name = name))
    }

    suspend fun setCustom(color: OklchColor) {
        persist(
            state.value.copy(
                name = AccentColors.CUSTOM,
                custom = AccentColors.clampCustom(
                    lightness = color.lightness,
                    chroma = color.chroma,
                    hue = color.hue,
                ),
            ),
        )
    }

    private suspend fun persist(state: AccentState) {
        preferences.setAccent(
            name = state.name,
            hue = state.custom.hue,
            lightness = state.custom.lightness,
            chroma = state.custom.chroma,
        )
    }

    private fun Map<String, JsonElement>.primitive(key: String): JsonPrimitive? =
        this[key] as? JsonPrimitive
}
