package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class ConnectSessionRequest(
    val clientName: String = "ferrotune-mobile",
    val clientId: String? = null,
)

@Serializable
data class ConnectSessionResponseDto(
    val id: String,
    val isNewSession: Boolean = false,
    val ownerClientId: String? = null,
    val ownerClientName: String = "",
)
