package com.ferrotune.feature.library.data

import androidx.paging.PagingSource
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.CollectionSongsParams
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.network.generated.FerrotuneArtistResponse
import com.ferrotune.core.network.generated.FerrotunePlayHistoryEntry
import com.ferrotune.core.network.generated.FerrotuneSimilarSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSongResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.toQueryMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Read access to the library: paged browse lists, details, favorites,
 * history, and the favorite mutations that back them.
 */
@Singleton
class LibraryRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    fun songs(
        query: String = MATCH_ALL,
        sort: SongSort = SongSort.TITLE,
        sortDir: SortDir = SortDir.ASC,
        starredOnly: Boolean = false,
        genre: String? = null,
        filter: String? = null,
    ): PagingSource<Int, SongResponse> = SearchSongsPagingSource(
        apiProvider,
        SearchParams(
            query = query,
            songSort = sort.apiValue,
            inlineImages = INLINE_IMAGES,
            songSortDir = sortDir.apiValue,
            starredOnly = starredOnly.takeIf { it },
            genre = genre,
            titleFilter = filter,
        ),
    )

    fun albums(
        query: String = MATCH_ALL,
        sort: AlbumSort = AlbumSort.NAME,
        sortDir: SortDir = SortDir.ASC,
        starredOnly: Boolean = false,
        filter: String? = null,
    ): PagingSource<Int, AlbumResponse> = SearchAlbumsPagingSource(
        apiProvider,
        SearchParams(
            query = query,
            albumSort = sort.apiValue,
            inlineImages = INLINE_IMAGES,
            albumSortDir = sortDir.apiValue,
            starredOnly = starredOnly.takeIf { it },
            albumFilter = filter,
        ),
    )

    fun artists(
        query: String = MATCH_ALL,
        sort: ArtistSort = ArtistSort.NAME,
        sortDir: SortDir = SortDir.ASC,
        starredOnly: Boolean = false,
        filter: String? = null,
    ): PagingSource<Int, ArtistResponse> = SearchArtistsPagingSource(
        apiProvider,
        SearchParams(
            query = query,
            artistSort = sort.apiValue,
            inlineImages = INLINE_IMAGES,
            artistSortDir = sortDir.apiValue,
            starredOnly = starredOnly.takeIf { it },
            artistFilter = filter,
        ),
    )

    fun history(
        filter: String? = null,
        sort: SongSort? = null,
        sortDir: SortDir? = null,
    ): PagingSource<Int, FerrotunePlayHistoryEntry> =
        HistoryPagingSource(apiProvider, filter = filter, sort = sort, sortDir = sortDir)

    /** Starred song/album/artist totals for the Favorites tab labels. */
    suspend fun favoritesCounts(): FavoritesCounts {
        val response = apiProvider.requireApi().search(
            mapOf(
                "query" to MATCH_ALL,
                "songCount" to "0",
                "albumCount" to "0",
                "artistCount" to "0",
                "starredOnly" to "true",
            ),
        )
        return FavoritesCounts(
            songs = response.searchResult.songTotal ?: 0,
            albums = response.searchResult.albumTotal ?: 0,
            artists = response.searchResult.artistTotal ?: 0,
        )
    }

    fun albumSongs(
        albumId: String,
        sort: SongSort? = null,
        sortDir: SortDir? = null,
        filter: String? = null,
    ): PagingSource<Int, SongResponse> = CollectionSongsPagingSource { offset, count ->
        apiProvider.requireApi().albumSongs(
            albumId,
            CollectionSongsParams(
                offset = offset.toLong(),
                count = count.toLong(),
                sort = sort?.apiValue,
                sortDir = sortDir?.apiValue,
                filter = filter,
            ).toQueryMap(),
        )
    }

    fun artistSongs(
        artistId: String,
        sort: SongSort? = null,
        sortDir: SortDir? = null,
        filter: String? = null,
    ): PagingSource<Int, SongResponse> = CollectionSongsPagingSource { offset, count ->
        apiProvider.requireApi().artistSongs(
            artistId,
            CollectionSongsParams(
                offset = offset.toLong(),
                count = count.toLong(),
                sort = sort?.apiValue,
                sortDir = sortDir?.apiValue,
                filter = filter,
            ).toQueryMap(),
        )
    }

    fun artistAlbums(artistId: String): PagingSource<Int, AlbumResponse> =
        ArtistAlbumsPagingSource(apiProvider, artistId)

    suspend fun album(albumId: String): FerrotuneAlbumResponse =
        apiProvider.requireApi().album(albumId)

    suspend fun artist(artistId: String): FerrotuneArtistResponse =
        apiProvider.requireApi().artist(artistId)

    suspend fun song(songId: String): FerrotuneSongResponse =
        apiProvider.requireApi().song(songId)

    suspend fun genres(): List<GenreResponse> =
        apiProvider.requireApi().genres().genres.genre

    suspend fun similarSongs(songId: String, count: Int = 99): FerrotuneSimilarSongsResponse =
        apiProvider.requireApi().similarSongs(songId, count)

    suspend fun activeServerUrl(): String = apiProvider.requireAccount().serverUrl

    suspend fun setStarred(
        songIds: List<String> = emptyList(),
        albumIds: List<String> = emptyList(),
        artistIds: List<String> = emptyList(),
        starred: Boolean,
    ) {
        val api = apiProvider.requireApi()
        val request = StarRequest(id = songIds, albumId = albumIds, artistId = artistIds)
        if (starred) api.star(request) else api.unstar(request)
    }

    companion object {
        const val MATCH_ALL = "*"
        const val INLINE_IMAGES = "medium"
    }
}

/** Starred totals shown in the Favorites tab labels. */
data class FavoritesCounts(
    val songs: Long,
    val albums: Long,
    val artists: Long,
)
