package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Hand-written because ts-rs does not export this request struct.
 */
@Serializable
data class SessionCommandRequest(
    val action: String,
    val positionMs: Long? = null,
    val currentIndex: Int? = null,
    val clientName: String? = null,
    val clientId: String? = null,
    val resumePlayback: Boolean? = null,
)

/**
 * Hand-written because ts-rs does not export this request struct.
 */
@Serializable
data class ConnectSessionRequest(
    val clientName: String = "ferrotune-mobile",
    val clientId: String? = null,
)
