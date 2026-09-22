package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.GetPlaylistSongsParams
import com.ferrotune.core.network.dto.SmartPlaylistSongsParams
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.core.network.paging.OffsetPagingSource
import com.ferrotune.core.network.toQueryMap

class PlaylistEntriesPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val playlistId: String,
    private val sort: String,
    private val sortDir: String,
    private val filter: String?,
    private val entryType: String?,
    override val pageSize: Int = DEFAULT_PAGE_SIZE,
) : OffsetPagingSource<PlaylistSongEntry>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<PlaylistSongEntry> {
        val response = apiProvider.requireApi().playlistSongs(
            playlistId,
            GetPlaylistSongsParams(
                offset = offset,
                count = count,
                sort = sort,
                sortDir = sortDir,
                filter = filter,
                entryType = entryType,
                inlineImages = "medium",
            ).toQueryMap(),
        )
        return PageResult(response.entries, response.filteredCount)
    }
}

class SmartPlaylistSongsPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val smartPlaylistId: String,
    private val filter: String?,
    private val sortField: String?,
    private val sortDirection: String?,
    override val pageSize: Int = DEFAULT_PAGE_SIZE,
) : OffsetPagingSource<SongResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<SongResponse> {
        val response = apiProvider.requireApi().smartPlaylistSongs(
            smartPlaylistId,
            SmartPlaylistSongsParams(
                offset = offset.toLong(),
                count = count.toLong(),
                inlineImages = "medium",
                filter = filter,
                sortField = sortField,
                sortDirection = sortDirection,
            ).toQueryMap(),
        )
        return PageResult(response.songs, response.totalCount)
    }
}

class SongSearchPagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val query: String,
    override val pageSize: Int = DEFAULT_PAGE_SIZE,
) : OffsetPagingSource<SongResponse>() {
    override suspend fun loadPage(offset: Int, count: Int): PageResult<SongResponse> {
        val response = apiProvider.requireApi().search(
            SearchParams(
                query = query,
                songCount = count,
                songOffset = offset,
                artistCount = 0,
                albumCount = 0,
                inlineImages = "medium",
            ).toQueryMap(),
        )
        return PageResult(response.searchResult.song, response.searchResult.songTotal)
    }
}
