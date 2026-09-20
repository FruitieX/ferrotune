package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class HomePageParams(
    val size: Long? = null,
    val inlineImages: String? = null,
    val discoverSeed: Long? = null,
    val forgottenFavSeed: Long? = null,
    val includeContinueListening: Boolean? = null,
    val includeMostPlayedRecently: Boolean? = null,
    val includeRecentlyAdded: Boolean? = null,
    val includeForgottenFavorites: Boolean? = null,
    val includeDiscover: Boolean? = null,
    val includeSimilarTracks: Boolean? = null,
)

@Serializable
data class ContinueListeningParams(
    val size: Long? = null,
    val offset: Long? = null,
    val inlineImages: String? = null,
    val filter: String? = null,
    val sort: String? = null,
    val sortDir: String? = null,
)

@Serializable
data class PeriodReviewQuery(
    val year: Int? = null,
    val month: Int? = null,
    val inlineImages: String? = null,
)

@Serializable
data class LogListeningRequest(
    val songId: String,
    val durationSeconds: Long,
    val sessionId: Long? = null,
    val skipped: Boolean = false,
)
