package com.ferrotune.core.network

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** One view's stored sort field and direction (web `{ field, direction }` shape). */
data class ViewSortConfig(
    val field: String,
    val direction: String,
)

/**
 * Sortable native views that remember their sort order server-side.
 *
 * Keys carry the native-only `-native` suffix so the web/Tauri client's
 * preferences of the same purpose are never clobbered.
 */
enum class ViewSortKey(val preferenceKey: String) {
    FAVORITE_SONGS("favorite-songs-sort-native"),
    FAVORITE_ALBUMS("favorites-album-sort-native"),
    FAVORITE_ARTISTS("favorites-artist-sort-native"),
    ALBUM_DETAIL("album-detail-sort-native"),
    ARTIST_DETAIL("artist-detail-sort-native"),
    GENRE_DETAIL("genre-detail-sort-native"),
    HISTORY("history-sort-native"),
    PLAYLIST_DETAIL("playlist-sort-native"),
}

/**
 * Per-view sort preferences shared by the library, history, and playlist
 * detail screens, read from [ServerPreferences].
 */
@Singleton
class ViewSortPreferencesRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val configs: StateFlow<Map<ViewSortKey, ViewSortConfig>> = preferences.snapshot.mapState { snapshot ->
        ViewSortKey.entries.mapNotNull { key ->
            (snapshot.preferences[key.preferenceKey] as? JsonPrimitive)?.contentOrNull
                ?.let { raw -> parse(raw)?.let { key to it } }
        }.toMap()
    }

    /** Best-effort load for view models; never throws. */
    suspend fun ensureLoaded(): Map<ViewSortKey, ViewSortConfig> {
        runCatching { preferences.ensureLoaded() }
        return configs.value
    }

    /** Stored config for [key], or [default] when nothing valid is stored. */
    fun config(key: ViewSortKey, default: ViewSortConfig): ViewSortConfig =
        configs.value[key] ?: default

    /** Stores [field]/[direction] for [key]; best-effort server write. */
    suspend fun setSort(key: ViewSortKey, field: String, direction: String) {
        val encoded = JsonPrimitive(encode(ViewSortConfig(field, direction)))
        runCatching { preferences.set(key.preferenceKey, encoded) }
    }

    private fun encode(config: ViewSortConfig): String = JsonObject(
        mapOf(
            "field" to JsonPrimitive(config.field),
            "direction" to JsonPrimitive(config.direction),
        ),
    ).toString()

    private fun parse(raw: String): ViewSortConfig? = runCatching {
        val root = FerrotuneJson.parseToJsonElement(raw).jsonObject
        val field = (root["field"] as? JsonPrimitive)?.contentOrNull ?: return@runCatching null
        val direction = (root["direction"] as? JsonPrimitive)?.contentOrNull
            ?: return@runCatching null
        ViewSortConfig(field, direction)
    }.getOrNull()
}
