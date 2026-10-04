package com.ferrotune.feature.library.data

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

data class LibrarySortConfig(
    val songs: SortConfig = SortConfig(SongSort.TITLE.apiValue, SortDir.ASC.apiValue),
    val albums: SortConfig = SortConfig(AlbumSort.NAME.apiValue, SortDir.ASC.apiValue),
    val artists: SortConfig = SortConfig(ArtistSort.NAME.apiValue, SortDir.ASC.apiValue),
) {
    fun songSort(): SongSort = SongSort.entries.firstOrNull { it.apiValue == songs.field }
        ?: SongSort.TITLE
    fun songDir(): SortDir = SortDir.entries.firstOrNull { it.apiValue == songs.direction }
        ?: SortDir.ASC
    fun albumSort(): AlbumSort = AlbumSort.entries.firstOrNull { it.apiValue == albums.field }
        ?: AlbumSort.NAME
    fun albumDir(): SortDir = SortDir.entries.firstOrNull { it.apiValue == albums.direction }
        ?: SortDir.ASC
    fun artistSort(): ArtistSort = ArtistSort.entries.firstOrNull { it.apiValue == artists.field }
        ?: ArtistSort.NAME
    fun artistDir(): SortDir = SortDir.entries.firstOrNull { it.apiValue == artists.direction }
        ?: SortDir.ASC
}

data class SortConfig(val field: String, val direction: String)

/**
 * Server-synced library view preferences (per-tab sort field and direction),
 * stored as JSON under the native-only `library-sort-native` preference key.
 *
 * The shared `library-sort` key is owned by the web/Tauri client, which stores
 * a single `{field, direction}` config there; writing the per-tab shape to it
 * would break that client's sort state.
 */
@Singleton
class LibraryViewPreferencesRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val sort: StateFlow<LibrarySortConfig> = preferences.snapshot.mapState { snapshot ->
        (snapshot.preferences[PREFERENCE_KEY] as? JsonPrimitive)?.contentOrNull?.let(::parse)
            ?: LibrarySortConfig()
    }

    /** Best-effort; never throws. */
    suspend fun ensureLoaded(): LibrarySortConfig {
        runCatching { preferences.ensureLoaded() }
        return sort.value
    }

    suspend fun setSongSort(sort: SongSort, direction: SortDir) {
        persist(this.sort.value.copy(songs = SortConfig(sort.apiValue, direction.apiValue)))
    }

    suspend fun setAlbumSort(sort: AlbumSort, direction: SortDir) {
        persist(this.sort.value.copy(albums = SortConfig(sort.apiValue, direction.apiValue)))
    }

    suspend fun setArtistSort(sort: ArtistSort, direction: SortDir) {
        persist(this.sort.value.copy(artists = SortConfig(sort.apiValue, direction.apiValue)))
    }

    private suspend fun persist(config: LibrarySortConfig) {
        preferences.set(PREFERENCE_KEY, JsonPrimitive(encode(config)))
    }

    private fun encode(config: LibrarySortConfig): String = JsonObject(
        mapOf(
            "songs" to encodeSort(config.songs),
            "albums" to encodeSort(config.albums),
            "artists" to encodeSort(config.artists),
        ),
    ).toString()

    private fun encodeSort(sort: SortConfig): JsonObject = JsonObject(
        mapOf(
            "field" to JsonPrimitive(sort.field),
            "direction" to JsonPrimitive(sort.direction),
        ),
    )

    private fun parse(raw: String): LibrarySortConfig? = runCatching {
        val root = FerrotuneJson.parseToJsonElement(raw).jsonObject
        LibrarySortConfig(
            songs = decodeSort(root["songs"]?.jsonObject, SongSort.TITLE.apiValue),
            albums = decodeSort(root["albums"]?.jsonObject, AlbumSort.NAME.apiValue),
            artists = decodeSort(root["artists"]?.jsonObject, ArtistSort.NAME.apiValue),
        )
    }.getOrNull()

    private fun decodeSort(
        element: JsonObject?,
        defaultField: String,
        defaultDirection: String = SortDir.ASC.apiValue,
    ): SortConfig = SortConfig(
        field = (element?.get("field") as? JsonPrimitive)?.contentOrNull ?: defaultField,
        direction = (element?.get("direction") as? JsonPrimitive)?.contentOrNull
            ?: defaultDirection,
    )

    companion object {
        const val PREFERENCE_KEY = "library-sort-native"
    }
}
