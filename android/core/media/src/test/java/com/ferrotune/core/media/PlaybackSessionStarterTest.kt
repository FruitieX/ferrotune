package com.ferrotune.core.media

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.StartQueueRequest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSessionStarterTest {

    @Test
    fun `search queue request carries filters sort and start song`() {
        val spec = QueueStartSpec(
            sourceType = "library",
            sourceName = "Songs",
            filters = mapOf("starredOnly" to JsonPrimitive(true)),
            sort = queueSort("name", "asc"),
            startSongId = "song-9",
        )

        val request = buildStartQueueRequest(spec, sessionId = "session-1", clientId = "client-1")

        assertEquals("library", request.sourceType)
        assertEquals("Songs", request.sourceName)
        assertEquals("session-1", request.sessionId)
        assertEquals("client-1", request.clientId)
        assertEquals("ferrotune-mobile", request.clientName)
        assertEquals("song-9", request.startSongId)
        assertEquals(JsonPrimitive(true), request.filters?.get("starredOnly"))
        assertEquals(JsonPrimitive("name"), request.sort?.get("field"))
        assertEquals(JsonPrimitive("asc"), request.sort?.get("direction"))
        assertNull(request.songIds)
        assertTrue(request.sources.isEmpty())
    }

    @Test
    fun `song id queue omits empty filters and sort`() {
        val spec = QueueStartSpec(
            sourceType = "other",
            songIds = listOf("1", "2"),
        )

        val request = buildStartQueueRequest(spec, sessionId = "session-1", clientId = "client-1")

        assertNull(request.filters)
        assertNull(request.sort)
        assertEquals(listOf("1", "2"), request.songIds)
    }

    @Test
    fun `request encodes camelCase wire fields`() {
        val spec = QueueStartSpec(
            sourceType = "album",
            sourceId = "album-1",
            startIndex = 3,
            shuffle = true,
        )

        val request = buildStartQueueRequest(spec, sessionId = "session-1", clientId = "client-1")
        val json = FerrotuneJson.encodeToString(StartQueueRequest.serializer(), request)

        assertTrue(json.contains("\"sourceType\":\"album\""))
        assertTrue(json.contains("\"sourceId\":\"album-1\""))
        assertTrue(json.contains("\"startIndex\":3"))
        assertTrue(json.contains("\"shuffle\":true"))
        assertFalse(json.contains("\"songIds\":["))
    }

    @Test
    fun `queue add next sends next position with current index`() {
        val request = buildAddToQueueRequest(
            spec = QueueAddSpec(songIds = listOf("song-1", "song-2")),
            sessionId = "session-1",
            position = QueueAddPosition.NEXT,
            currentIndex = 4L,
        )

        assertEquals("session-1", request.sessionId)
        assertEquals(listOf("song-1", "song-2"), request.songIds)
        assertEquals(JsonPrimitive("next"), request.position)
        assertEquals(4L, request.currentIndex)
        assertTrue(request.sources.isEmpty())
    }

    @Test
    fun `queue add end sends sources without song ids`() {
        val request = buildAddToQueueRequest(
            spec = QueueAddSpec(
                sources = listOf(QueueSourceRequest(sourceType = "album", sourceId = "album-1")),
            ),
            sessionId = "session-1",
            position = QueueAddPosition.END,
            currentIndex = null,
        )

        assertEquals(JsonPrimitive("end"), request.position)
        assertNull(request.currentIndex)
        assertTrue(request.songIds.isEmpty())
        assertEquals("album", request.sources.single().sourceType)
        assertEquals("album-1", request.sources.single().sourceId)
    }
}
