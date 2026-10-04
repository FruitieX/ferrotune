package com.ferrotune.feature.player.data

import com.ferrotune.core.network.FerrotuneJson
import kotlinx.serialization.json.encodeToJsonElement
import com.ferrotune.core.network.dto.MoveInQueueRequest
import com.ferrotune.core.network.dto.RepeatModeRequest
import com.ferrotune.core.network.dto.ShuffleRequest
import com.ferrotune.core.network.generated.GetQueueResponse
import com.ferrotune.core.network.generated.QueueSongEntry
import com.ferrotune.core.network.generated.QueueSourceInfo
import com.ferrotune.core.network.generated.QueueSuccessResponse
import com.ferrotune.core.network.generated.QueueWindow
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

internal fun testSong(id: String, title: String = "Song $id"): SongResponse = SongResponse(
    id = id,
    title = title,
    artist = "Artist",
    artistId = "artist-1",
    size = 1024,
    contentType = "audio/flac",
    suffix = "flac",
    duration = 1000,
    path = "Artist/Album/$id.flac",
    created = "2026-01-01T00:00:00.000Z",
    type = "music",
)

internal fun testQueueResponse(
    currentIndex: Int = 0,
    totalCount: Int = 3,
    offset: Int = 0,
): GetQueueResponse = GetQueueResponse(
    totalCount = totalCount.toLong(),
    currentIndex = currentIndex.toLong(),
    positionMs = 0,
    isShuffled = false,
    repeatMode = "off",
    source = QueueSourceInfo(type = "library", name = "Library", instanceId = "instance-1"),
    window = QueueWindow(
        offset = offset.toLong(),
        songs = (offset until (offset + totalCount)).map { position ->
            QueueSongEntry(
                entryId = "entry-$position",
                position = position.toLong(),
                song = FerrotuneJson.encodeToJsonElement(testSong("song-$position")),
            )
        },
    ),
    version = 1,
)

class QueueRepositoryTest {

    @Test
    fun `queue edits carry the session id`() = runTest {
        val api = FakeQueueApi()
        val repository = QueueRepository(FakeApiProvider(api))

        repository.removeEntry("session-1", 4)
        repository.clear("session-1")
        repository.moveEntry("session-1", 4, 2)
        repository.setShuffled("session-1", true)
        repository.setRepeatMode("session-1", "all")

        assertEquals(4L, api.removedPosition)
        assertEquals("session-1", api.removeParams?.get("sessionId"))
        assertTrue(api.cleared)
        assertEquals(MoveInQueueRequest("session-1", 4, 2), api.moveRequest)
        assertEquals(ShuffleRequest("session-1", true), api.shuffleRequest)
        assertEquals(RepeatModeRequest("session-1", "all"), api.repeatRequest)
    }
}
