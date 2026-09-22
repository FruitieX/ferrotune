package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Hand-written because ts-rs does not export this request struct.
 */
@Serializable
data class ConnectSessionRequest(
    val clientName: String = "ferrotune-mobile",
    val clientId: String? = null,
)
