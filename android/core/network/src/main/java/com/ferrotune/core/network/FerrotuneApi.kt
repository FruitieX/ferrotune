package com.ferrotune.core.network

import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.dto.AuthMeResponseDto
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.RatingRequest
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.ArtistAlbumsResponse
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.ConnectSessionResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumListResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.network.generated.FerrotuneArtistResponse
import com.ferrotune.core.network.generated.FerrotuneGenresResponse
import com.ferrotune.core.network.generated.FerrotunePlayHistoryResponse
import com.ferrotune.core.network.generated.FerrotuneRandomSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSearchResponse
import com.ferrotune.core.network.generated.FerrotuneSimilarSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSongResponse
import com.ferrotune.core.network.generated.FerrotuneStarredResponse
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

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
    suspend fun connectSession(@Body request: ConnectSessionRequest): ConnectSessionResponse

    @POST("api/queue/start")
    suspend fun startQueue(@Body request: StartQueueRequest): StartQueueResponse

    @GET("api/songs/random")
    suspend fun randomSongs(@Query("size") size: Int): FerrotuneRandomSongsResponse

    @GET("api/search")
    suspend fun search(@QueryMap params: Map<String, String>): FerrotuneSearchResponse

    @GET("api/artists/{id}")
    suspend fun artist(@Path("id") id: String): FerrotuneArtistResponse

    @GET("api/artists/{id}/albums")
    suspend fun artistAlbums(
        @Path("id") id: String,
        @Query("offset") offset: Int,
        @Query("count") count: Int,
    ): ArtistAlbumsResponse

    @GET("api/artists/{id}/songs")
    suspend fun artistSongs(
        @Path("id") id: String,
        @QueryMap params: Map<String, String>,
    ): CollectionSongsResponse

    @GET("api/albums")
    suspend fun albums(@QueryMap params: Map<String, String>): FerrotuneAlbumListResponse

    @GET("api/albums/{id}")
    suspend fun album(@Path("id") id: String): FerrotuneAlbumResponse

    @GET("api/albums/{id}/songs")
    suspend fun albumSongs(
        @Path("id") id: String,
        @QueryMap params: Map<String, String>,
    ): CollectionSongsResponse

    @GET("api/songs/{id}")
    suspend fun song(@Path("id") id: String): FerrotuneSongResponse

    @GET("api/songs/{id}/similar")
    suspend fun similarSongs(
        @Path("id") id: String,
        @Query("count") count: Int,
    ): FerrotuneSimilarSongsResponse

    @GET("api/genres")
    suspend fun genres(): FerrotuneGenresResponse

    @GET("api/history")
    suspend fun history(@QueryMap params: Map<String, String>): FerrotunePlayHistoryResponse

    @GET("api/starred")
    suspend fun starred(): FerrotuneStarredResponse

    @POST("api/star")
    suspend fun star(@Body request: StarRequest)

    @POST("api/unstar")
    suspend fun unstar(@Body request: StarRequest)

    @POST("api/rating")
    suspend fun setRating(@Body request: RatingRequest)
}
