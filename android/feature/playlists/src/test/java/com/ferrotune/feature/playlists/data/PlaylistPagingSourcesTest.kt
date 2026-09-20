package com.ferrotune.feature.playlists.data

import androidx.paging.PagingSource
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.SmartPlaylistSongsResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi as FakePlaylistApi
import com.ferrotune.feature.playlists.testSong
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistPagingSourcesTest {

    private val entries = (0 until 120).map { entry("$it") }

    private fun entry(id: String) = PlaylistSongEntry(
        entryId = "entry-$id",
        position = id.toInt(),
        entryType = "song",
        songIndex = id.toInt(),
        song = testSong("song-$id"),
    )

    @Test
    fun `playlist entries page forwards offset count and filters`() = runBlocking {
        var seenParams: Map<String, String>? = null
        val api = FakePlaylistApi(
            onPlaylistSongs = { _, params ->
                seenParams = params
                val offset = params["offset"]?.toInt() ?: 0
                val count = params["count"]?.toInt() ?: 0
                playlistResponse(entries.drop(offset).take(count), filteredCount = entries.size)
            }
        )
        val source = PlaylistEntriesPagingSource(
            apiProvider = FakeApiProvider(api),
            playlistId = "playlist-1",
            sort = "custom",
            sortDir = "asc",
            filter = "beach",
            entryType = "song",
            pageSize = 50,
        )

        val page = source.load(refreshParams()) as PagingSource.LoadResult.Page

        assertEquals(50, page.data.size)
        assertEquals(50, page.nextKey)
        assertEquals("0", seenParams?.get("offset"))
        assertEquals("50", seenParams?.get("count"))
        assertEquals("custom", seenParams?.get("sort"))
        assertEquals("beach", seenParams?.get("filter"))
        assertEquals("song", seenParams?.get("entryType"))
        assertEquals("medium", seenParams?.get("inlineImages"))
    }

    @Test
    fun `playlist entries stop paging at the filtered total`() = runBlocking {
        val api = FakePlaylistApi(
            onPlaylistSongs = { _, params ->
                val offset = params["offset"]?.toInt() ?: 0
                val count = params["count"]?.toInt() ?: 0
                playlistResponse(entries.drop(offset).take(count), filteredCount = 100)
            }
        )
        val source = PlaylistEntriesPagingSource(
            apiProvider = FakeApiProvider(api),
            playlistId = "playlist-1",
            sort = "custom",
            sortDir = "asc",
            filter = null,
            entryType = null,
            pageSize = 50,
        )

        val page = source.load(nextParams(100)) as PagingSource.LoadResult.Page

        assertEquals(20, page.data.size)
        assertNull(page.nextKey)
    }

    @Test
    fun `smart playlist songs page forwards paging and sort overrides`() = runBlocking {
        var seenParams: Map<String, String>? = null
        val songs = (0 until 120).map { testSong("$it") }
        val api = FakePlaylistApi(
            onSmartPlaylistSongs = { _, params ->
                seenParams = params
                val offset = params["offset"]?.toInt() ?: 0
                val count = params["count"]?.toInt() ?: 0
                SmartPlaylistSongsResponse(
                    id = "smart-1",
                    name = "Smart",
                    totalCount = songs.size.toLong(),
                    totalDuration = 120_000,
                    offset = offset.toLong(),
                    songs = songs.drop(offset).take(count),
                )
            }
        )
        val source = SmartPlaylistSongsPagingSource(
            apiProvider = FakeApiProvider(api),
            smartPlaylistId = "smart-1",
            filter = null,
            sortField = "playCount",
            sortDirection = "desc",
            pageSize = 50,
        )

        val page = source.load(refreshParams()) as PagingSource.LoadResult.Page

        assertEquals(50, page.data.size)
        assertEquals("playCount", seenParams?.get("sortField"))
        assertEquals("desc", seenParams?.get("sortDirection"))
        assertEquals("medium", seenParams?.get("inlineImages"))
    }

    private fun playlistResponse(
        page: List<PlaylistSongEntry>,
        filteredCount: Int,
    ) = com.ferrotune.core.network.generated.PlaylistSongsResponse(
        id = "playlist-1",
        name = "Playlist",
        owner = "tester",
        public = false,
        totalEntries = filteredCount.toLong(),
        matchedCount = filteredCount.toLong(),
        missingCount = 0,
        duration = 3600,
        filteredCount = filteredCount.toLong(),
        created = "2026-01-01T00:00:00.000Z",
        changed = "2026-01-01T00:00:00.000Z",
        sharedWithMe = false,
        canEdit = true,
        entries = page,
    )

    private fun refreshParams() = PagingSource.LoadParams.Refresh<Int>(
        key = null,
        loadSize = 50,
        placeholdersEnabled = false,
    )

    private fun nextParams(key: Int) = PagingSource.LoadParams.Append<Int>(
        key = key,
        loadSize = 50,
        placeholdersEnabled = false,
    )
}
