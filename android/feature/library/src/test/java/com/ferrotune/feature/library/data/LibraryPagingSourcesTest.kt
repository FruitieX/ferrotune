package com.ferrotune.feature.library.data

import androidx.paging.PagingSource
import com.ferrotune.core.network.FerrotuneApi
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.dto.AuthMeResponseDto
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.RatingRequest
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.ArtistAlbumsResponse
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.ConnectSessionResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumListResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.network.generated.FerrotuneArtistResponse
import com.ferrotune.core.network.generated.FerrotuneGenresResponse
import com.ferrotune.core.network.generated.FerrotunePlayHistoryResponse
import com.ferrotune.core.network.generated.FerrotuneRandomSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSearchContent
import com.ferrotune.core.network.generated.FerrotuneSearchResponse
import com.ferrotune.core.network.generated.FerrotuneSimilarSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSongResponse
import com.ferrotune.core.network.generated.FerrotuneStarredResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LibraryPagingSourcesTest {

    private val songs = (0 until 120).map { song("$it") }

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

    private val provider = object : FerrotuneApiProvider {
        override suspend fun requireApi(): FerrotuneApi = api
    }

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

    private fun song(id: String): SongResponse = SongResponse(
        id = id,
        title = "Song $id",
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
}

private class FakeFerrotuneApi(
    private val onSearch: (Map<String, String>) -> FerrotuneSearchResponse = { error("unused") },
) : FerrotuneApi {
    override suspend fun login(request: AuthLoginRequest): AuthLoginResponseDto = error("unused")
    override suspend fun me(): AuthMeResponseDto = error("unused")
    override suspend fun refresh(): AuthSessionRefreshResponseDto = error("unused")
    override suspend fun logout() = error("unused")
    override suspend fun connectSession(request: ConnectSessionRequest): ConnectSessionResponse =
        error("unused")

    override suspend fun startQueue(request: StartQueueRequest): StartQueueResponse = error("unused")
    override suspend fun randomSongs(size: Int): FerrotuneRandomSongsResponse = error("unused")
    override suspend fun search(params: Map<String, String>): FerrotuneSearchResponse =
        onSearch(params)

    override suspend fun artist(id: String): FerrotuneArtistResponse = error("unused")
    override suspend fun artistAlbums(id: String, offset: Int, count: Int): ArtistAlbumsResponse =
        error("unused")

    override suspend fun artistSongs(
        id: String,
        params: Map<String, String>,
    ): CollectionSongsResponse = error("unused")

    override suspend fun albums(params: Map<String, String>): FerrotuneAlbumListResponse =
        error("unused")

    override suspend fun album(id: String): FerrotuneAlbumResponse = error("unused")
    override suspend fun albumSongs(
        id: String,
        params: Map<String, String>,
    ): CollectionSongsResponse = error("unused")

    override suspend fun song(id: String): FerrotuneSongResponse = error("unused")
    override suspend fun similarSongs(id: String, count: Int): FerrotuneSimilarSongsResponse =
        error("unused")

    override suspend fun genres(): FerrotuneGenresResponse = error("unused")
    override suspend fun history(params: Map<String, String>): FerrotunePlayHistoryResponse =
        error("unused")

    override suspend fun starred(): FerrotuneStarredResponse = error("unused")
    override suspend fun star(request: StarRequest) = error("unused")
    override suspend fun unstar(request: StarRequest) = error("unused")
    override suspend fun setRating(request: RatingRequest) = error("unused")
}
