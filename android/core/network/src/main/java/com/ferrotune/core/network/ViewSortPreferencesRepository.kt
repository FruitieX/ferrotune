package com.ferrotune.core.network

import com.ferrotune.core.network.generated.SetPreferenceRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.Json
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
 * Server-synced per-view sort preferences shared by the library, history, and
 * playlist detail screens. Follows [LibraryViewPreferencesRepository]'s
 * account-scoped, best-effort pattern.
 */
@Singleton
class ViewSortPreferencesRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) : AccountScopedPreferences {
    private val json = Json { ignoreUnknownKeys = true }

    private val _configs = MutableStateFlow<Map<ViewSortKey, ViewSortConfig>>(emptyMap())
    val configs: StateFlow<Map<ViewSortKey, ViewSortConfig>> = _configs.asStateFlow()

    @Volatile
    private var loaded = false

    /** Best-effort load for view models; never throws. */
    suspend fun ensureLoaded(): Map<ViewSortKey, ViewSortConfig> {
        if (!loaded) {
            runCatching { load() }
        }
        return _configs.value
    }

    /** Loads the current account's view sorts; callers can surface failures. */
    suspend fun load() {
        val prefs = apiProvider.requireApi().preferences().preferences
        _configs.value = ViewSortKey.entries.mapNotNull { key ->
            (prefs[key.preferenceKey] as? JsonPrimitive)?.contentOrNull
                ?.let { raw -> parse(raw)?.let { key to it } }
        }.toMap()
        loaded = true
    }

    /** Drops the cache so the next [ensureLoaded] re-reads for a new account. */
    override fun invalidate() {
        loaded = false
    }

    /** Stored config for [key], or [default] when nothing valid is stored. */
    fun config(key: ViewSortKey, default: ViewSortConfig): ViewSortConfig =
        _configs.value[key] ?: default

    /** Stores [field]/[direction] for [key]; best-effort server write. */
    suspend fun setSort(key: ViewSortKey, field: String, direction: String) {
        val config = ViewSortConfig(field, direction)
        _configs.update { it + (key to config) }
        runCatching {
            apiProvider.requireApi().setPreference(
                key.preferenceKey,
                SetPreferenceRequest(JsonPrimitive(encode(config))),
            )
        }
    }

    private fun encode(config: ViewSortConfig): String = JsonObject(
        mapOf(
            "field" to JsonPrimitive(config.field),
            "direction" to JsonPrimitive(config.direction),
        ),
    ).toString()

    private fun parse(raw: String): ViewSortConfig? = runCatching {
        val root = json.parseToJsonElement(raw).jsonObject
        val field = (root["field"] as? JsonPrimitive)?.contentOrNull ?: return@runCatching null
        val direction = (root["direction"] as? JsonPrimitive)?.contentOrNull
            ?: return@runCatching null
        ViewSortConfig(field, direction)
    }.getOrNull()
}
