package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Body of `POST /api/star` and `POST /api/unstar`.
 */
@Serializable
data class StarRequest(
    val id: List<String> = emptyList(),
    val albumId: List<String> = emptyList(),
    val artistId: List<String> = emptyList(),
)

/**
 * Body of `POST /api/rating`.
 */
@Serializable
data class RatingRequest(
    val id: String,
    val rating: Int,
)
