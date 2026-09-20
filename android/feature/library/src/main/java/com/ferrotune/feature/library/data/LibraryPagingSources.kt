package com.ferrotune.feature.library.data

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.FerrotunePlayHistoryEntry
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.toQueryMap

internal const val LIBRARY_PAGE_SIZE = 50

/**
 * Offset-keyed paging over an endpoint that reports a total count.
 */
abstract class OffsetPagingSource<T : Any> : PagingSource<Int, T>() {
    protected abstract val pageSize: Int

    protected abstract suspend fun loadPage(offset: Int, count: Int): PageResult<T>

    protected data class PageResult<T>(
        val items: List<T>,
        val total: Long?,
    )

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, T> {
        val offset = params.key ?: 0
        return try {
            val page = loadPage(offset, pageSize)
            val reachedEnd = when {
                page.items.isEmpty() -> true
                page.items.size < pageSize -> true
                page.total != null -> offset + page.items.size >= page.total
                else -> false
            }
            LoadResult.Page(
                data = page.items,
                prevKey = if (offset > 0) maxOf(0, offset - pageSize) else null,
                nextKey = if (reachedEnd) null else offset + pageSize,
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    override fun getRefreshKey(state: PagingState<Int, T>): Int? {
        val anchor = state.anchorPosition ?: return null
        return (anchor / pageSize) * pageSize
    }
}

class SearchSongsPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val baseParams: SearchParams,
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
) : OffsetPagingSource<SongResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<SongResponse> {
        val response = apiProvider.requireApi().search(
            baseParams.copy(
                songCount = count,
                songOffset = offset,
                artistCount = 0,
                albumCount = 0,
            ).toQueryMap()
        )
        return PageResult(response.searchResult.song, response.searchResult.songTotal)
    }
}

class SearchAlbumsPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val baseParams: SearchParams,
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
) : OffsetPagingSource<AlbumResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<AlbumResponse> {
        val response = apiProvider.requireApi().search(
            baseParams.copy(
                albumCount = count,
                albumOffset = offset,
                artistCount = 0,
                songCount = 0,
            ).toQueryMap()
        )
        return PageResult(response.searchResult.album, response.searchResult.albumTotal)
    }
}

class SearchArtistsPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val baseParams: SearchParams,
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
) : OffsetPagingSource<ArtistResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<ArtistResponse> {
        val response = apiProvider.requireApi().search(
            baseParams.copy(
                artistCount = count,
                artistOffset = offset,
                albumCount = 0,
                songCount = 0,
            ).toQueryMap()
        )
        return PageResult(response.searchResult.artist, response.searchResult.artistTotal)
    }
}

class CollectionSongsPagingSource(
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
    private val fetch: suspend (offset: Int, count: Int) -> CollectionSongsResponse,
) : OffsetPagingSource<SongResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<SongResponse> {
        val response = fetch(offset, count)
        return PageResult(response.songs, response.total)
    }
}

class ArtistAlbumsPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val artistId: String,
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
) : OffsetPagingSource<AlbumResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<AlbumResponse> {
        val response = apiProvider.requireApi().artistAlbums(artistId, offset, count)
        return PageResult(response.albums, response.total)
    }
}

class HistoryPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    override val pageSize: Int = LIBRARY_PAGE_SIZE,
) : OffsetPagingSource<FerrotunePlayHistoryEntry>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<FerrotunePlayHistoryEntry> {
        val response = apiProvider.requireApi().history(
            mapOf(
                "offset" to offset.toString(),
                "size" to count.toString(),
            )
        )
        return PageResult(response.entry, response.total)
    }
}
