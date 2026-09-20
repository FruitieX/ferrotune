package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class ApiErrorDto(
    val error: String? = null,
)

@Serializable
data class AuthLoginRequest(
    val username: String,
    val password: String,
    val clientName: String = "ferrotune-mobile",
)

@Serializable
data class AuthUserDto(
    val id: Long,
    val username: String,
    val email: String? = null,
    val isAdmin: Boolean = false,
)

@Serializable
data class AuthLoginResponseDto(
    val user: AuthUserDto,
    val sessionToken: String,
    val sessionExpiresAt: String,
    val urlToken: String,
    val urlTokenExpiresAt: String,
)

@Serializable
data class AuthMeResponseDto(
    val user: AuthUserDto,
)

@Serializable
data class AuthSessionRefreshResponseDto(
    val sessionExpiresAt: String,
)
