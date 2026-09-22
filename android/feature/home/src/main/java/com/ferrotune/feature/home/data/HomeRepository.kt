package com.ferrotune.feature.home.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.PeriodReviewQuery
import com.ferrotune.core.network.generated.DiscoveryResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumListResponse
import com.ferrotune.core.network.generated.HomeContinueListeningSection
import com.ferrotune.core.network.generated.HomeForgottenFavoritesSection
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.MostPlayedRecentlyResponse
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.generated.StatsResponse
import com.ferrotune.core.network.toQueryMap
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HomeRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    suspend fun continueListening(
        size: Long = DEFAULT_SECTION_SIZE,
    ): HomeContinueListeningSection = apiProvider.requireApi().continueListening(
        mapOf(
            "size" to size.toString(),
            "offset" to "0",
            "inlineImages" to INLINE_IMAGES,
        ),
    )

    suspend fun mostPlayedRecently(
        since: String,
        size: Long = DEFAULT_SECTION_SIZE,
    ): MostPlayedRecentlyResponse = apiProvider.requireApi().mostPlayedRecently(
        mapOf(
            "size" to size.toString(),
            "offset" to "0",
            "since" to since,
            "inlineImages" to INLINE_IMAGES,
        ),
    )

    suspend fun forgottenFavorites(
        minPlays: Int,
        notPlayedSinceDays: Int,
        size: Long = DEFAULT_SECTION_SIZE,
    ): HomeForgottenFavoritesSection = apiProvider.requireApi().forgottenFavorites(
        mapOf(
            "size" to size.toString(),
            "offset" to "0",
            "minPlays" to minPlays.toString(),
            "notPlayedSinceDays" to notPlayedSinceDays.toString(),
            "inlineImages" to INLINE_IMAGES,
        ),
    )

    suspend fun albumList(
        type: String,
        size: Long = DEFAULT_SECTION_SIZE,
        since: String? = null,
        seed: Long? = null,
    ): FerrotuneAlbumListResponse = apiProvider.requireApi().albums(
        buildMap {
            put("type", type)
            put("size", size.toString())
            put("offset", "0")
            put("inlineImages", INLINE_IMAGES)
            since?.let { put("since", it) }
            seed?.let { put("seed", it.toString()) }
        },
    )

    suspend fun similarTracks(
        size: Long = DEFAULT_SECTION_SIZE,
    ): DiscoveryResponse = apiProvider.requireApi().discoverySimilarSongs(
        mapOf(
            "size" to size.toString(),
            "offset" to "0",
            "inlineImages" to INLINE_IMAGES,
        ),
    )

    suspend fun playlistSongs(
        playlistId: String,
        size: Long = DEFAULT_SECTION_SIZE,
    ): List<SongResponse> = apiProvider.requireApi().playlistSongs(
        playlistId,
        mapOf(
            "offset" to "0",
            "count" to size.toString(),
            "entryType" to "song",
            "inlineImages" to INLINE_IMAGES,
        ),
    ).entries.mapNotNull { it.song }

    suspend fun smartPlaylistSongs(
        smartPlaylistId: String,
        size: Long = DEFAULT_SECTION_SIZE,
    ): List<SongResponse> = apiProvider.requireApi().smartPlaylistSongs(
        smartPlaylistId,
        mapOf(
            "offset" to "0",
            "count" to size.toString(),
            "inlineImages" to INLINE_IMAGES,
        ),
    ).songs

    suspend fun stats(): StatsResponse = apiProvider.requireApi().stats()

    suspend fun listeningStats(): ListeningStatsResponse =
        apiProvider.requireApi().listeningStats()

    suspend fun periodReview(year: Int? = null, month: Int? = null): PeriodReviewResponse =
        apiProvider.requireApi().periodReview(
            PeriodReviewQuery(year = year, month = month, inlineImages = "medium").toQueryMap(),
        )

    suspend fun activeServerUrl(): String = apiProvider.requireAccount().serverUrl

    companion object {
        const val DEFAULT_SECTION_SIZE = 15L
        const val INLINE_IMAGES = "medium"
    }
}
