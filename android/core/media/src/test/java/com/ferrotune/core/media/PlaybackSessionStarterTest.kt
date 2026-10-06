package com.ferrotune.core.media

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.generated.GetQueueResponse
import com.ferrotune.core.network.generated.QueueSourceInfo
import com.ferrotune.core.network.generated.QueueWindow
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

    @Test
    fun `queue add without a session starts an other queue from song ids`() {
        val spec = queueStartSpecForAdd(QueueAddSpec(songIds = listOf("song-1", "song-2")))

        assertEquals(QUEUE_SOURCE_OTHER, spec.sourceType)
        assertEquals(listOf("song-1", "song-2"), spec.songIds)
        assertTrue(spec.sources.isEmpty())
    }

    @Test
    fun `queue add without a session keeps collection sources`() {
        val sources = listOf(QueueSourceRequest(sourceType = "album", sourceId = "album-1"))

        val spec = queueStartSpecForAdd(QueueAddSpec(sources = sources))

        assertEquals(QUEUE_SOURCE_OTHER, spec.sourceType)
        assertNull(spec.songIds)
        assertEquals(sources, spec.sources)
    }

    @Test
    fun `start queue request carries collection sources`() {
        val sources = listOf(QueueSourceRequest(sourceType = "playlist", sourceId = "playlist-1"))
        val spec = QueueStartSpec(sourceType = QUEUE_SOURCE_OTHER, sources = sources)

        val request = buildStartQueueRequest(spec, sessionId = "session-1", clientId = "client-1")

        assertEquals(sources, request.sources)
    }

    @Test
    fun `restore skips an empty server queue`() {
        assertNull(restoredQueue(queueResponse(total = 0, index = 0, positionMs = 0)))
    }

    @Test
    fun `restore resumes the saved index and position`() {
        val restore = restoredQueue(queueResponse(total = 12, index = 4, positionMs = 61_000))

        assertEquals(RestoredQueue(totalCount = 12, currentIndex = 4, positionMs = 61_000), restore)
    }

    @Test
    fun `restore clamps a stale index past the end of the queue`() {
        val restore = restoredQueue(queueResponse(total = 3, index = 7, positionMs = -5))

        assertEquals(RestoredQueue(totalCount = 3, currentIndex = 2, positionMs = 0), restore)
    }

    private fun queueResponse(total: Long, index: Long, positionMs: Long) = GetQueueResponse(
        totalCount = total,
        currentIndex = index,
        positionMs = positionMs,
        isShuffled = false,
        repeatMode = "off",
        source = QueueSourceInfo(type = "album", id = "album-1", name = "Album", instanceId = "i-1"),
        window = QueueWindow(offset = 0, songs = emptyList()),
        version = 1,
    )

    @Test
    fun `without search terms a filtered view queues its full list from the tapped song`() {
        val spec = QueueStartSpec(
            sourceType = "album",
            sourceId = "al-1",
            filters = queueTextFilter("blue") + mapOf("minYear" to JsonPrimitive(1990)),
            startIndex = 2,
            startSongId = "so-9",
        )

        val full = spec.withoutSearchTerm()

        assertNull(full.filters["filter"])
        assertEquals(JsonPrimitive(1990), full.filters["minYear"])
        assertEquals("so-9", full.startSongId)
        val unfiltered = QueueStartSpec(sourceType = "album")
        assertEquals(unfiltered, unfiltered.withoutSearchTerm())
    }
}
