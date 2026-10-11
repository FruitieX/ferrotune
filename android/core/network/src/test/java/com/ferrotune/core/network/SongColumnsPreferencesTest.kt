package com.ferrotune.core.network

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class SongColumnsPreferencesTest {
    @Test
    fun roundTripsChosenColumnsPerView() {
        val columns = mapOf(
            SongListView.PLAYLIST to setOf(SongColumn.ARTIST, SongColumn.PLAY_COUNT),
            SongListView.ALBUM to emptySet(),
        )

        assertEquals(columns, parseSongColumns(encodeSongColumns(columns)))
    }

    @Test
    fun ignoresUnknownViewsAndColumns() {
        val stored = JsonObject(
            mapOf(
                "library" to JsonArray(listOf(JsonPrimitive("year"), JsonPrimitive("mood"))),
                "someday" to JsonArray(listOf(JsonPrimitive("year"))),
            ),
        )

        assertEquals(mapOf(SongListView.LIBRARY_SONGS to setOf(SongColumn.YEAR)), parseSongColumns(stored))
        assertEquals(emptyMap<SongListView, Set<SongColumn>>(), parseSongColumns(JsonPrimitive("x")))
    }
}
