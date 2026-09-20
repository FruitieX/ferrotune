package com.ferrotune.core.network

import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.dto.AuthMeResponseDto
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Authentication endpoints. Instances are bound to one server URL and,
 * optionally, one session token.
 */
interface FerrotuneAuthApi {
    @POST("api/auth/login")
    suspend fun login(@Body request: AuthLoginRequest): AuthLoginResponseDto

    @GET("api/auth/me")
    suspend fun me(): AuthMeResponseDto

    @POST("api/auth/refresh")
    suspend fun refresh(): AuthSessionRefreshResponseDto

    @POST("api/auth/logout")
    suspend fun logout()
}
