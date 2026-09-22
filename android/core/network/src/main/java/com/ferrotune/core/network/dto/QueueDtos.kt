package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class QueueParams(
    val sessionId: String? = null,
    val offset: Int? = null,
    val limit: Int? = null,
    val inlineImages: String? = null,
)

@Serializable
data class QueueWindowParams(
    val sessionId: String? = null,
    val radius: Int? = null,
    val inlineImages: String? = null,
)

@Serializable
data class SessionParams(
    val sessionId: String? = null,
)

@Serializable
data class MoveInQueueRequest(
    val sessionId: String?,
    val fromPosition: Long,
    val toPosition: Long,
)

@Serializable
data class ShuffleRequest(
    val sessionId: String?,
    val enabled: Boolean,
)

@Serializable
data class RepeatModeRequest(
    val sessionId: String?,
    val mode: String,
)
