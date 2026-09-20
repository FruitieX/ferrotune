package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.dto.UpdateFolderRequest
import com.ferrotune.core.network.generated.ImportPlaylistRequest
import com.ferrotune.core.network.generated.ImportPlaylistResponse
import com.ferrotune.core.network.generated.MovePlaylistEntryRequest
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.RemovePlaylistSongsRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi as FakePlaylistApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistRepositoryTest {

    private fun folderResponse() = PlaylistFolderResponse(
        id = "folder-1",
        name = "Chill",
        parentId = null,
        position = 0,
        createdAt = "2026-01-01T00:00:00.000Z",
        hasCoverArt = false,
    )

    @Test
    fun `updateFolder sends explicit null to move to the root`() = runBlocking {
        var seen: UpdateFolderRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onUpdateFolder = { _, request ->
                        seen = request
                        folderResponse()
                    }
                )
            )
        )

        repository.updateFolder("folder-1", parentId = JsonNull)

        assertEquals(JsonNull, seen?.parentId)
        assertNull(seen?.name)
    }

    @Test
    fun `updateFolder omits parent when only renaming`() = runBlocking {
        var seen: UpdateFolderRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onUpdateFolder = { _, request ->
                        seen = request
                        folderResponse()
                    }
                )
            )
        )

        repository.updateFolder("folder-1", name = "Focus")

        assertEquals("Focus", seen?.name)
        assertNull(seen?.parentId)
    }

    @Test
    fun `updateFolder reparents with a folder id`() = runBlocking {
        var seen: UpdateFolderRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onUpdateFolder = { _, request ->
                        seen = request
                        folderResponse()
                    }
                )
            )
        )

        repository.updateFolder("folder-1", parentId = JsonPrimitive("folder-2"))

        assertEquals(JsonPrimitive("folder-2"), seen?.parentId)
    }

    @Test
    fun `removeSongs sends stored positions`() = runBlocking {
        var seen: RemovePlaylistSongsRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onRemoveSongs = { _, request -> seen = request }
                )
            )
        )

        repository.removeSongs("playlist-1", listOf(0, 3, 7))

        assertEquals(listOf(0, 3, 7), seen?.indexes)
    }

    @Test
    fun `moveEntry sends the entry and target position`() = runBlocking {
        var seen: MovePlaylistEntryRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onMoveEntry = { _, request -> seen = request }
                )
            )
        )

        repository.moveEntry("playlist-1", "entry-4", 0)

        assertEquals("entry-4", seen?.entryId)
        assertEquals(0, seen?.toPosition)
    }

    @Test
    fun `createPlaylist maps song ids to import entries`() = runBlocking {
        var seen: ImportPlaylistRequest? = null
        val repository = PlaylistRepository(
            FakeApiProvider(
                FakePlaylistApi(
                    onImportPlaylist = { request ->
                        seen = request
                        ImportPlaylistResponse(
                            playlistId = "playlist-9",
                            matchedCount = request.entries.size,
                            missingCount = 0,
                        )
                    }
                )
            )
        )

        val response = repository.createPlaylist(
            name = "Road trip",
            songIds = listOf("song-1", "song-2"),
            folderId = "folder-1",
        )

        assertEquals("playlist-9", response.playlistId)
        assertEquals(listOf("song-1", "song-2"), seen?.entries?.map { it.songId })
        assertEquals("folder-1", seen?.folderId)
    }
}
