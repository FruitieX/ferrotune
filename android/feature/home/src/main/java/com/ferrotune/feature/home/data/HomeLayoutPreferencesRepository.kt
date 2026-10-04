package com.ferrotune.feature.home.data

import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray

/**
 * Dashboard layout: quick tiles and sections, read from [ServerPreferences]
 * under the web/Tauri client's `home-tiles-v1` and `home-sections-v1` keys so
 * both clients stay in sync.
 */
@Singleton
class HomeLayoutPreferencesRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val tiles: StateFlow<List<HomeTileConfig>> = preferences.snapshot.mapState { snapshot ->
        (snapshot.preferences[KEY_TILES] as? JsonArray)?.let(::parseHomeTiles)
            ?: DEFAULT_HOME_TILES
    }

    val sections: StateFlow<List<HomeSectionConfig>> = preferences.snapshot.mapState { snapshot ->
        (snapshot.preferences[KEY_SECTIONS] as? JsonArray)?.let(::parseHomeSections)
            ?: DEFAULT_HOME_SECTIONS
    }

    /** Best-effort; the defaults apply when nothing is known. */
    suspend fun ensureLoaded() {
        runCatching { preferences.ensureLoaded() }
    }

    /** Re-reads the server's preferences; callers can surface failures. */
    suspend fun load() {
        preferences.refresh()
    }

    suspend fun setTiles(tiles: List<HomeTileConfig>) {
        preferences.set(KEY_TILES, encodeHomeTiles(tiles))
    }

    suspend fun setSections(sections: List<HomeSectionConfig>) {
        preferences.set(KEY_SECTIONS, encodeHomeSections(normalizeHomeSections(sections)))
    }

    companion object {
        const val KEY_TILES = "home-tiles-v1"
        const val KEY_SECTIONS = "home-sections-v1"
    }
}
