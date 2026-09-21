package com.ferrotune.feature.home.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.SetPreferenceRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray

/**
 * Server-synced dashboard layout: quick tiles and sections, stored under the
 * web/Tauri client's `home-tiles-v1` and `home-sections-v1` preference keys so
 * both clients stay in sync.
 */
@Singleton
class HomeLayoutPreferencesRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    private val _tiles = MutableStateFlow(DEFAULT_HOME_TILES)
    val tiles: StateFlow<List<HomeTileConfig>> = _tiles.asStateFlow()

    private val _sections = MutableStateFlow(DEFAULT_HOME_SECTIONS)
    val sections: StateFlow<List<HomeSectionConfig>> = _sections.asStateFlow()

    @Volatile
    private var loaded = false

    suspend fun ensureLoaded() {
        if (!loaded) {
            runCatching { load() }
        }
    }

    suspend fun load() {
        val prefs = apiProvider.requireApi().preferences().preferences
        _tiles.value = (prefs[KEY_TILES] as? JsonArray)?.let(::parseHomeTiles)
            ?: DEFAULT_HOME_TILES
        _sections.value = (prefs[KEY_SECTIONS] as? JsonArray)?.let(::parseHomeSections)
            ?: DEFAULT_HOME_SECTIONS
        loaded = true
    }

    fun invalidate() {
        loaded = false
    }

    suspend fun setTiles(tiles: List<HomeTileConfig>) {
        persist(KEY_TILES, encodeHomeTiles(tiles))
        _tiles.value = tiles
    }

    suspend fun setSections(sections: List<HomeSectionConfig>) {
        val normalized = normalizeHomeSections(sections)
        persist(KEY_SECTIONS, encodeHomeSections(normalized))
        _sections.value = normalized
    }

    private suspend fun persist(key: String, value: JsonArray) {
        apiProvider.requireApi().setPreference(key, SetPreferenceRequest(value))
    }

    companion object {
        const val KEY_TILES = "home-tiles-v1"
        const val KEY_SECTIONS = "home-sections-v1"
    }
}
