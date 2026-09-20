package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class StartQueueRequest(
    val sessionId: String? = null,
    val sourceType: String,
    val sourceId: String? = null,
    val sourceName: String? = null,
    val startIndex: Int = 0,
    val startSongId: String? = null,
    val shuffle: Boolean = false,
    val repeatMode: String? = null,
    val songIds: List<String>? = null,
    val clientId: String? = null,
    val clientName: String = "ferrotune-mobile",
)

@Serializable
data class QueueSourceDto(
    val type: String? = null,
    val id: String? = null,
    val name: String? = null,
)

@Serializable
data class StartQueueResponseDto(
    val totalCount: Int = 0,
    val currentIndex: Int = 0,
    val isShuffled: Boolean = false,
    val repeatMode: String = "off",
    val source: QueueSourceDto? = null,
)
