package com.ferrotune.core.network

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Optional facts a song row can show (web `ColumnVisibility`, laid out for a phone row). */
enum class SongColumn(val value: String, val label: String) {
    INDEX("trackNumber", "Track number"),
    COVER("cover", "Cover art"),
    ARTIST("artist", "Artist"),
    ALBUM("album", "Album"),
    DURATION("duration", "Duration"),
    FAVORITE("starred", "Favorite"),
    YEAR("year", "Year"),
    GENRE("genre", "Genre"),
    PLAY_COUNT("playCount", "Plays"),
    LIKES("likes", "Likes"),
    RATING("rating", "Rating"),
    FORMAT("format", "Format & bitrate"),
    DATE_ADDED("dateAdded", "Date added"),
    LAST_PLAYED("lastPlayed", "Last played"),
}

/** Song listings whose columns are chosen separately (web: one column atom per view). */
enum class SongListView(val value: String) {
    LIBRARY_SONGS("library"),
    ALBUM("album"),
    ARTIST("artist"),
    GENRE("genre"),
    PLAYLIST("playlist"),
    SMART_PLAYLIST("smart-playlist"),
    FAVORITES("favorites"),
    HISTORY("history"),
    HOME_SECTION("home-section"),
    SONG_RADIO("song-radio"),
}

/**
 * Server-synced visible song columns per listing, stored under one
 * native-only key as `{view: [column, ...]}`. Views without a stored choice
 * use the screen's defaults.
 */
@Singleton
class SongColumnsPreferencesRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val columns: StateFlow<Map<SongListView, Set<SongColumn>>> = preferences.snapshot.mapState { snapshot ->
        parseSongColumns(snapshot.preferences[PREFERENCE_KEY])
    }

    /** Best-effort; views use their defaults until preferences arrive. */
    suspend fun ensureLoaded() {
        runCatching { preferences.ensureLoaded() }
    }

    /** Best-effort; a refused write rolls back (see [ServerPreferences.set]). */
    suspend fun setColumns(view: SongListView, columns: Set<SongColumn>) {
        val updated = this.columns.value + (view to columns)
        runCatching { preferences.set(PREFERENCE_KEY, encodeSongColumns(updated)) }
    }

    /** Drops the view's stored choice so it follows the screen defaults again. */
    suspend fun reset(view: SongListView) {
        val updated = columns.value - view
        runCatching { preferences.set(PREFERENCE_KEY, encodeSongColumns(updated)) }
    }

    companion object {
        const val PREFERENCE_KEY = "song-columns-native"
    }
}

internal fun parseSongColumns(element: JsonElement?): Map<SongListView, Set<SongColumn>> {
    val views = element as? JsonObject ?: return emptyMap()
    return SongListView.entries.mapNotNull { view ->
        val stored = views[view.value] as? JsonArray ?: return@mapNotNull null
        val names = stored.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
        view to SongColumn.entries.filter { it.value in names }.toSet()
    }.toMap()
}

internal fun encodeSongColumns(columns: Map<SongListView, Set<SongColumn>>): JsonObject =
    JsonObject(
        columns.entries.associate { (view, visible) ->
            view.value to JsonArray(
                SongColumn.entries.filter { it in visible }.map { JsonPrimitive(it.value) },
            )
        },
    )
