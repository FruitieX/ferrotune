package com.ferrotune.feature.home.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.dto.HomePageParams
import com.ferrotune.core.network.dto.PeriodReviewQuery
import com.ferrotune.core.network.generated.HomePageResponse
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.StatsResponse
import com.ferrotune.core.network.toQueryMap
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HomeRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    suspend fun home(size: Long = DEFAULT_SECTION_SIZE): HomePageResponse =
        apiProvider.requireApi().home(
            HomePageParams(size = size, inlineImages = "medium").toQueryMap(),
        )

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
    }
}
