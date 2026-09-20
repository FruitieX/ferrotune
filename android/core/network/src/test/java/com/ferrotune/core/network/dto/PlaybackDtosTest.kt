package com.ferrotune.core.network.dto

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.generated.ConnectSessionResponse
import com.ferrotune.core.network.generated.FerrotuneRandomSongsResponse
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
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
            startIndex = 0,
            shuffle = false,
            songIds = listOf("1", "2"),
            sources = emptyList(),
            clientId = "client-1",
            keepPlaying = false,
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
              "source": {
                "type": "other",
                "id": null,
                "name": "Random songs",
                "filters": null,
                "sort": null,
                "instanceId": "instance-1"
              },
              "window": {
                "offset": 0,
                "songs": [{"entryId": "entry-1", "position": 0, "song": {"id": "1"}}]
              }
            }
        """.trimIndent()

        val response = FerrotuneJson.decodeFromString(StartQueueResponse.serializer(), body)

        assertEquals(120L, response.totalCount)
        assertEquals(3L, response.currentIndex)
        assertTrue(response.isShuffled)
        assertEquals("all", response.repeatMode)
        assertEquals("other", response.source.type)
        assertEquals("Random songs", response.source.name)
    }

    @Test
    fun `connect session response parses owner fields`() {
        val body =
            """{"id": "session-1", "isNewSession": true, "ownerClientName": "ferrotune-mobile"}"""

        val response = FerrotuneJson.decodeFromString(ConnectSessionResponse.serializer(), body)

        assertEquals("session-1", response.id)
        assertTrue(response.isNewSession)
        assertEquals(null, response.ownerClientId)
        assertEquals("ferrotune-mobile", response.ownerClientName)
    }

    @Test
    fun `random songs response parses song array`() {
        val body = """
            {
              "song": [{
                "id": "1",
                "title": "Track",
                "artist": "Artist",
                "artistId": "artist-1",
                "size": 5242880,
                "contentType": "audio/flac",
                "suffix": "flac",
                "duration": 245000,
                "path": "Artist/Album/01 Track.flac",
                "created": "2026-01-01T00:00:00.000Z",
                "type": "music",
                "coverArt": "abc",
                "replayGainTrackGain": -6.5
              }]
            }
        """.trimIndent()

        val response = FerrotuneJson.decodeFromString(FerrotuneRandomSongsResponse.serializer(), body)

        assertEquals(1, response.song.size)
        assertEquals("Track", response.song.first().title)
        assertEquals(245_000L, response.song.first().duration)
        assertEquals("abc", response.song.first().coverArt)
        assertEquals(-6.5, response.song.first().replayGainTrackGain!!, 0.0001)
    }
}
