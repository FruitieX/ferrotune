package com.ferrotune.core.network.dto

import com.ferrotune.core.network.FerrotuneJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDtosTest {

    @Test
    fun `start queue request serializes camelCase fields`() {
        val request = StartQueueRequest(
            sessionId = "session-1",
            sourceType = "other",
            sourceName = "Random songs",
            songIds = listOf("1", "2"),
            clientId = "client-1",
        )

        val json = FerrotuneJson.encodeToString(StartQueueRequest.serializer(), request)

        assertTrue(json.contains("\"sourceType\":\"other\""))
        assertTrue(json.contains("\"songIds\":[\"1\",\"2\"]"))
        assertTrue(json.contains("\"sessionId\":\"session-1\""))
        assertTrue(json.contains("\"clientId\":\"client-1\""))
        assertTrue(json.contains("\"startIndex\":0"))
    }

    @Test
    fun `start queue response ignores unknown window payload`() {
        val body = """
            {
              "totalCount": 120,
              "currentIndex": 3,
              "isShuffled": true,
              "repeatMode": "all",
              "source": {"type": "other", "id": null, "name": "Random songs"},
              "window": {"start": 0, "songs": [{"id": "1", "title": "Track"}]}
            }
        """.trimIndent()

        val response = FerrotuneJson.decodeFromString(StartQueueResponseDto.serializer(), body)

        assertEquals(120, response.totalCount)
        assertEquals(3, response.currentIndex)
        assertTrue(response.isShuffled)
        assertEquals("all", response.repeatMode)
        assertEquals("other", response.source?.type)
        assertEquals("Random songs", response.source?.name)
    }

    @Test
    fun `connect session response tolerates missing owner fields`() {
        val body = """{"id": "session-1", "isNewSession": true}"""

        val response = FerrotuneJson.decodeFromString(ConnectSessionResponseDto.serializer(), body)

        assertEquals("session-1", response.id)
        assertTrue(response.isNewSession)
        assertEquals(null, response.ownerClientId)
        assertEquals("", response.ownerClientName)
    }

    @Test
    fun `random songs response parses song array`() {
        val body = """
            {"song": [{"id": "1", "title": "Track", "artist": "Artist", "duration": 245000, "coverArt": "abc"}]}
        """.trimIndent()

        val response = FerrotuneJson.decodeFromString(RandomSongsResponseDto.serializer(), body)

        assertEquals(1, response.song.size)
        assertEquals("Track", response.song.first().title)
        assertEquals(245_000L, response.song.first().duration)
        assertEquals("abc", response.song.first().coverArt)
    }
}
