package com.ferrotune.feature.library.data

import androidx.paging.PagingSource
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSearchContent
import com.ferrotune.core.network.generated.FerrotuneSearchResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.feature.library.testSong
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LibraryPagingSourcesTest {

    private val songs = (0 until 120).map { testSong("$it") }

    private val api = FakeFerrotuneApi(
        onSearch = { params ->
            val offset = params["songOffset"]?.toInt() ?: 0
            val count = params["songCount"]?.toInt() ?: 0
            FerrotuneSearchResponse(
                FerrotuneSearchContent(
                    artist = emptyList(),
                    album = emptyList(),
                    song = songs.drop(offset).take(count),
                    songTotal = songs.size.toLong(),
                )
            )
        }
    )

    private val provider = FakeApiProvider(api)

    @Test
    fun `first page loads and points at the next offset`() = runBlocking {
        val source = SearchSongsPagingSource(provider, SearchParams(query = "*"), pageSize = 50)

        val page = source.load(refreshParams()) as PagingSource.LoadResult.Page

        assertEquals(50, page.data.size)
        assertEquals(0, page.data.first().id.toInt())
        assertNull(page.prevKey)
        assertEquals(50, page.nextKey)
    }

    @Test
    fun `last page stops paging at the reported total`() = runBlocking {
        val source = SearchSongsPagingSource(provider, SearchParams(query = "*"), pageSize = 50)

        val page = source.load(nextParams(100)) as PagingSource.LoadResult.Page

        assertEquals(20, page.data.size)
        assertEquals(50, page.prevKey)
        assertNull(page.nextKey)
    }

    @Test
    fun `refresh key snaps the anchor position to a page boundary`() = runBlocking {
        val source = SearchSongsPagingSource(provider, SearchParams(query = "*"), pageSize = 50)
        source.load(refreshParams())

        val state = source.getRefreshKey(
            androidx.paging.PagingState(
                pages = listOf(
                    PagingSource.LoadResult.Page(
                        data = songs.take(50),
                        prevKey = null,
                        nextKey = 50,
                    )
                ),
                anchorPosition = 74,
                config = androidx.paging.PagingConfig(pageSize = 50),
                leadingPlaceholderCount = 0,
            )
        )

        assertEquals(50, state)
    }

    @Test
    fun `album songs paging forwards offset and count`() = runBlocking {
        val source = CollectionSongsPagingSource(
            fetch = { offset, count ->
                CollectionSongsResponse(
                    songs = songs.drop(offset).take(count),
                    total = songs.size.toLong(),
                    offset = offset.toLong(),
                )
            },
            pageSize = 50,
        )

        val page = source.load(refreshParams()) as PagingSource.LoadResult.Page

        assertEquals(50, page.data.size)
        assertEquals(50, page.nextKey)
    }

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
