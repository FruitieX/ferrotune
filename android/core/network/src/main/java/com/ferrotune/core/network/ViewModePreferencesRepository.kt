package com.ferrotune.core.network

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Web `ViewMode`: cards in a grid, or rows in a list. */
enum class ViewMode(val value: String) {
    GRID("grid"),
    LIST("list"),
}

/**
 * Collection views with a grid/list toggle. Keys carry the native-only
 * `-native` suffix so the phone's choice doesn't change the web/desktop one.
 */
enum class ViewModeKey(val preferenceKey: String) {
    LIBRARY_ALBUMS("album-view-native"),
    LIBRARY_ARTISTS("artist-view-native"),
    FAVORITE_ALBUMS("favorites-album-view-native"),
    FAVORITE_ARTISTS("favorites-artist-view-native"),
    PLAYLISTS("playlists-view-native"),
}

/** Server-synced grid/list choices (web `*ViewModeAtom`), grid by default like the web. */
@Singleton
class ViewModePreferencesRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val modes: StateFlow<Map<ViewModeKey, ViewMode>> = preferences.snapshot.mapState { snapshot ->
        ViewModeKey.entries.mapNotNull { key ->
            val raw = (snapshot.preferences[key.preferenceKey] as? JsonPrimitive)?.contentOrNull
            ViewMode.entries.firstOrNull { it.value == raw }?.let { key to it }
        }.toMap()
    }

    /** Best-effort; views fall back to the grid until preferences arrive. */
    suspend fun ensureLoaded() {
        runCatching { preferences.ensureLoaded() }
    }

    fun mode(key: ViewModeKey): ViewMode = modes.value[key] ?: ViewMode.GRID

    /** Best-effort; a refused write rolls back (see [ServerPreferences.set]). */
    suspend fun setMode(key: ViewModeKey, mode: ViewMode) {
        runCatching { preferences.set(key.preferenceKey, JsonPrimitive(mode.value)) }
    }
}
