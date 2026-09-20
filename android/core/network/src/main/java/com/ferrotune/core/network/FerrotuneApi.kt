package com.ferrotune.core.network

import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.dto.AuthMeResponseDto
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.ConnectSessionResponseDto
import com.ferrotune.core.network.dto.RandomSongsResponseDto
import com.ferrotune.core.network.dto.StartQueueRequest
import com.ferrotune.core.network.dto.StartQueueResponseDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Native API surface. Instances are bound to one server URL and, optionally,
 * one bearer session token.
 */
interface FerrotuneApi {
    @POST("api/auth/login")
    suspend fun login(@Body request: AuthLoginRequest): AuthLoginResponseDto

    @GET("api/auth/me")
    suspend fun me(): AuthMeResponseDto

    @POST("api/auth/refresh")
    suspend fun refresh(): AuthSessionRefreshResponseDto

    @POST("api/auth/logout")
    suspend fun logout()

    @POST("api/sessions")
    suspend fun connectSession(@Body request: ConnectSessionRequest): ConnectSessionResponseDto

    @POST("api/queue/start")
    suspend fun startQueue(@Body request: StartQueueRequest): StartQueueResponseDto

    @GET("api/songs/random")
    suspend fun randomSongs(@Query("size") size: Int): RandomSongsResponseDto
}
