package com.ferrotune.core.network

import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.MoveInQueueRequest
import com.ferrotune.core.network.dto.QueueParams
import com.ferrotune.core.network.dto.QueueWindowParams
import com.ferrotune.core.network.dto.RepeatModeRequest
import com.ferrotune.core.network.dto.SessionParams
import com.ferrotune.core.network.dto.ShuffleRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.dto.AuthMeResponseDto
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.CreateFolderRequest
import com.ferrotune.core.network.dto.LogListeningRequest
import com.ferrotune.core.network.dto.MovePlaylistRequest
import com.ferrotune.core.network.dto.RatingRequest
import com.ferrotune.core.network.dto.ReorderPlaylistRequest
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.dto.UpdateFolderRequest
import com.ferrotune.core.network.generated.AddPlaylistSongsRequest
import com.ferrotune.core.network.generated.ArtistAlbumsResponse
import com.ferrotune.core.network.generated.BatchMatchEntriesRequest
import com.ferrotune.core.network.generated.BatchMatchEntriesResponse
import com.ferrotune.core.network.generated.CollectionSongsResponse
import com.ferrotune.core.network.generated.ConnectSessionResponse
import com.ferrotune.core.network.generated.CreateSmartPlaylistRequest
import com.ferrotune.core.network.generated.CreateSmartPlaylistResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumListResponse
import com.ferrotune.core.network.generated.GetQueueResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.network.generated.FerrotuneArtistResponse
import com.ferrotune.core.network.generated.FerrotuneGenresResponse
import com.ferrotune.core.network.generated.FerrotunePlayHistoryResponse
import com.ferrotune.core.network.generated.FerrotuneRandomSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSearchResponse
import com.ferrotune.core.network.generated.FerrotuneSimilarSongsResponse
import com.ferrotune.core.network.generated.FerrotuneSongResponse
import com.ferrotune.core.network.generated.FerrotuneStarredResponse
import com.ferrotune.core.network.generated.HomeContinueListeningSection
import com.ferrotune.core.network.generated.HomePageResponse
import com.ferrotune.core.network.generated.ImportPlaylistRequest
import com.ferrotune.core.network.generated.ImportPlaylistResponse
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.LogListeningResponse
import com.ferrotune.core.network.generated.MatchMissingEntryRequest
import com.ferrotune.core.network.generated.MaterializeSmartPlaylistRequest
import com.ferrotune.core.network.generated.MusicFoldersResponse
import com.ferrotune.core.network.generated.MaterializeSmartPlaylistResponse
import com.ferrotune.core.network.generated.MovePlaylistEntryRequest
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.network.generated.PlaylistMembershipRequest
import com.ferrotune.core.network.generated.PlaylistMembershipResponse
import com.ferrotune.core.network.generated.PlaylistSharesResponse
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.generated.QueueSuccessResponse
import com.ferrotune.core.network.generated.RecentPlaylistsResponse
import com.ferrotune.core.network.generated.RemovePlaylistSongsRequest
import com.ferrotune.core.network.generated.SetPlaylistSharesRequest
import com.ferrotune.core.network.generated.ShareableUsersResponse
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SmartPlaylistSongsResponse
import com.ferrotune.core.network.generated.SmartPlaylistsResponse
import com.ferrotune.core.network.generated.SongPlaylistsResponse
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
import com.ferrotune.core.network.generated.StatsResponse
import com.ferrotune.core.network.generated.TransferPlaylistOwnershipRequest
import com.ferrotune.core.network.generated.UnmatchEntryRequest
import com.ferrotune.core.network.generated.UpdatePlaylistRequest
import com.ferrotune.core.network.generated.UpdateSmartPlaylistRequest
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
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

    @GET("api/queue")
    suspend fun queue(@QueryMap params: Map<String, String>): GetQueueResponse

    @GET("api/queue/current-window")
    suspend fun queueWindow(@QueryMap params: Map<String, String>): GetQueueResponse

    @DELETE("api/queue")
    suspend fun clearQueue(@QueryMap params: Map<String, String>): QueueSuccessResponse

    @DELETE("api/queue/{position}")
    suspend fun removeFromQueue(
        @Path("position") position: Long,
        @QueryMap params: Map<String, String>,
    ): QueueSuccessResponse

    @POST("api/queue/move")
    suspend fun moveInQueue(@Body request: MoveInQueueRequest): QueueSuccessResponse

    @POST("api/queue/shuffle")
    suspend fun toggleQueueShuffle(@Body request: ShuffleRequest): QueueSuccessResponse

    @POST("api/queue/repeat")
    suspend fun setQueueRepeatMode(@Body request: RepeatModeRequest): QueueSuccessResponse

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

    @GET("api/home")
    suspend fun home(@QueryMap params: Map<String, String>): HomePageResponse

    @GET("api/continue-listening")
    suspend fun continueListening(
        @QueryMap params: Map<String, String>,
    ): HomeContinueListeningSection

    @GET("api/stats")
    suspend fun stats(): StatsResponse

    @GET("api/listening/stats")
    suspend fun listeningStats(): ListeningStatsResponse

    @GET("api/listening/review")
    suspend fun periodReview(@QueryMap params: Map<String, String>): PeriodReviewResponse

    @POST("api/listening")
    suspend fun logListening(@Body request: LogListeningRequest): LogListeningResponse

    @GET("api/playlist-folders")
    suspend fun playlistFolders(): PlaylistFoldersResponse

    @POST("api/playlist-folders")
    suspend fun createPlaylistFolder(@Body request: CreateFolderRequest): PlaylistFolderResponse

    @PATCH("api/playlist-folders/{id}")
    suspend fun updatePlaylistFolder(
        @Path("id") id: String,
        @Body request: UpdateFolderRequest,
    ): PlaylistFolderResponse

    @DELETE("api/playlist-folders/{id}")
    suspend fun deletePlaylistFolder(@Path("id") id: String)

    @POST("api/playlists/import")
    suspend fun importPlaylist(@Body request: ImportPlaylistRequest): ImportPlaylistResponse

    @GET("api/playlists/{id}/songs")
    suspend fun playlistSongs(
        @Path("id") id: String,
        @QueryMap params: Map<String, String>,
    ): PlaylistSongsResponse

    @PUT("api/playlists/{id}")
    suspend fun updatePlaylist(
        @Path("id") id: String,
        @Body request: UpdatePlaylistRequest,
    ): PlaylistSongsResponse

    @DELETE("api/playlists/{id}")
    suspend fun deletePlaylist(@Path("id") id: String)

    @POST("api/playlists/{id}/songs")
    suspend fun addPlaylistSongs(
        @Path("id") id: String,
        @Body request: AddPlaylistSongsRequest,
    )

    @HTTP(method = "DELETE", path = "api/playlists/{id}/songs", hasBody = true)
    suspend fun removePlaylistSongs(
        @Path("id") id: String,
        @Body request: RemovePlaylistSongsRequest,
    )

    @PATCH("api/playlists/{id}/move")
    suspend fun movePlaylist(
        @Path("id") id: String,
        @Body request: MovePlaylistRequest,
    )

    @PUT("api/playlists/{id}/reorder")
    suspend fun reorderPlaylistSongs(
        @Path("id") id: String,
        @Body request: ReorderPlaylistRequest,
    )

    @POST("api/playlists/{id}/move-entry")
    suspend fun movePlaylistEntry(
        @Path("id") id: String,
        @Body request: MovePlaylistEntryRequest,
    )

    @POST("api/playlists/{id}/match-missing")
    suspend fun matchMissingEntry(
        @Path("id") id: String,
        @Body request: MatchMissingEntryRequest,
    )

    @POST("api/playlists/{id}/unmatch")
    suspend fun unmatchEntry(
        @Path("id") id: String,
        @Body request: UnmatchEntryRequest,
    )

    @POST("api/playlists/{id}/batch-match")
    suspend fun batchMatchEntries(
        @Path("id") id: String,
        @Body request: BatchMatchEntriesRequest,
    ): BatchMatchEntriesResponse

    @GET("api/playlists/containing-songs")
    suspend fun playlistsContainingSongs(
        @Query("songId") songIds: List<String>,
    ): SongPlaylistsResponse

    @POST("api/playlists/membership")
    suspend fun playlistMembership(
        @Body request: PlaylistMembershipRequest,
    ): PlaylistMembershipResponse

    @GET("api/playlists/recently-played")
    suspend fun recentlyPlayedPlaylists(): RecentPlaylistsResponse

    @GET("api/users/shareable")
    suspend fun shareableUsers(): ShareableUsersResponse

    @GET("api/music-folders")
    suspend fun musicFolders(): MusicFoldersResponse

    @GET("api/playlists/{id}/shares")
    suspend fun playlistShares(@Path("id") id: String): PlaylistSharesResponse

    @PUT("api/playlists/{id}/shares")
    suspend fun setPlaylistShares(
        @Path("id") id: String,
        @Body request: SetPlaylistSharesRequest,
    ): PlaylistSharesResponse

    @POST("api/playlists/{id}/transfer-ownership")
    suspend fun transferPlaylistOwnership(
        @Path("id") id: String,
        @Body request: TransferPlaylistOwnershipRequest,
    )

    @GET("api/smart-playlists")
    suspend fun smartPlaylists(): SmartPlaylistsResponse

    @GET("api/smart-playlists/{id}")
    suspend fun smartPlaylist(@Path("id") id: String): SmartPlaylistInfo

    @POST("api/smart-playlists")
    suspend fun createSmartPlaylist(
        @Body request: CreateSmartPlaylistRequest,
    ): CreateSmartPlaylistResponse

    @PUT("api/smart-playlists/{id}")
    suspend fun updateSmartPlaylist(
        @Path("id") id: String,
        @Body request: UpdateSmartPlaylistRequest,
    )

    @DELETE("api/smart-playlists/{id}")
    suspend fun deleteSmartPlaylist(@Path("id") id: String)

    @GET("api/smart-playlists/{id}/songs")
    suspend fun smartPlaylistSongs(
        @Path("id") id: String,
        @QueryMap params: Map<String, String>,
    ): SmartPlaylistSongsResponse

    @POST("api/smart-playlists/{id}/materialize")
    suspend fun materializeSmartPlaylist(
        @Path("id") id: String,
        @Body request: MaterializeSmartPlaylistRequest,
    ): MaterializeSmartPlaylistResponse
}
