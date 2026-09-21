package com.ferrotune.core.testing

import com.ferrotune.core.model.Account
import com.ferrotune.core.network.FerrotuneApi
import com.ferrotune.core.network.FerrotuneApiProvider
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
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.GetQueueResponse
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
import com.ferrotune.core.network.generated.MaterializeSmartPlaylistResponse
import com.ferrotune.core.network.generated.MovePlaylistEntryRequest
import com.ferrotune.core.network.generated.MusicFoldersResponse
import com.ferrotune.core.network.generated.PreferencesResponse
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
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.network.generated.UpdatePreferencesRequest
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

fun testAccount(): Account = Account(
    id = "test",
    label = "Test",
    serverUrl = "http://localhost:4040",
    username = "tester",
    userId = 1L,
    email = "",
    isAdmin = false,
    sessionToken = "token",
    sessionExpiresAt = "",
)

class FakeApiProvider(
    val api: FerrotuneApi,
    private val account: Account = testAccount(),
) : FerrotuneApiProvider {
    override suspend fun requireApi(): FerrotuneApi = api

    override suspend fun requireAccount(): Account = account
}

/**
 * [FerrotuneApi] test double. Every endpoint fails with `error("unused")`
 * unless a handler is supplied; add a handler here when a new test needs it.
 */
open class FakeFerrotuneApi(
    private val onSearch: (Map<String, String>) -> FerrotuneSearchResponse = { error("unused") },
    private val onGenres: () -> FerrotuneGenresResponse = { error("unused") },
    private val onAlbum: (String) -> FerrotuneAlbumResponse = { error("unused") },
    private val onPlaylistSongs: (String, Map<String, String>) -> PlaylistSongsResponse =
        { _, _ -> error("unused") },
    private val onSmartPlaylistSongs: (String, Map<String, String>) -> SmartPlaylistSongsResponse =
        { _, _ -> error("unused") },
    private val onPlaylistFolders: () -> PlaylistFoldersResponse = { error("unused") },
    private val onUpdateFolder: (String, UpdateFolderRequest) -> PlaylistFolderResponse =
        { _, _ -> error("unused") },
    private val onRemoveSongs: (String, RemovePlaylistSongsRequest) -> Unit =
        { _, _ -> error("unused") },
    private val onMoveEntry: (String, MovePlaylistEntryRequest) -> Unit =
        { _, _ -> error("unused") },
    private val onImportPlaylist: (ImportPlaylistRequest) -> ImportPlaylistResponse =
        { error("unused") },
) : FerrotuneApi {

    override suspend fun login(request: AuthLoginRequest): AuthLoginResponseDto = error("unused")
    override suspend fun me(): AuthMeResponseDto = error("unused")
    override suspend fun refresh(): AuthSessionRefreshResponseDto = error("unused")
    override suspend fun logout() = error("unused")
    override suspend fun connectSession(request: ConnectSessionRequest): ConnectSessionResponse =
        error("unused")

    override suspend fun startQueue(request: StartQueueRequest): StartQueueResponse = error("unused")

    override suspend fun queue(params: Map<String, String>): GetQueueResponse = error("unused")

    override suspend fun queueWindow(params: Map<String, String>): GetQueueResponse = error("unused")

    override suspend fun clearQueue(params: Map<String, String>): QueueSuccessResponse =
        error("unused")

    override suspend fun removeFromQueue(
        position: Long,
        params: Map<String, String>,
    ): QueueSuccessResponse = error("unused")

    override suspend fun moveInQueue(request: MoveInQueueRequest): QueueSuccessResponse =
        error("unused")

    override suspend fun toggleQueueShuffle(request: ShuffleRequest): QueueSuccessResponse =
        error("unused")

    override suspend fun setQueueRepeatMode(request: RepeatModeRequest): QueueSuccessResponse =
        error("unused")
    override suspend fun randomSongs(size: Int): FerrotuneRandomSongsResponse = error("unused")
    override suspend fun search(params: Map<String, String>): FerrotuneSearchResponse =
        onSearch(params)

    override suspend fun artist(id: String): FerrotuneArtistResponse = error("unused")
    override suspend fun artistAlbums(id: String, offset: Int, count: Int): ArtistAlbumsResponse =
        error("unused")

    override suspend fun artistSongs(
        id: String,
        params: Map<String, String>,
    ): CollectionSongsResponse = error("unused")

    override suspend fun albums(params: Map<String, String>): FerrotuneAlbumListResponse =
        error("unused")

    override suspend fun album(id: String): FerrotuneAlbumResponse = onAlbum(id)
    override suspend fun albumSongs(
        id: String,
        params: Map<String, String>,
    ): CollectionSongsResponse = error("unused")

    override suspend fun song(id: String): FerrotuneSongResponse = error("unused")
    override suspend fun similarSongs(id: String, count: Int): FerrotuneSimilarSongsResponse =
        error("unused")

    override suspend fun genres(): FerrotuneGenresResponse = onGenres()
    override suspend fun history(params: Map<String, String>): FerrotunePlayHistoryResponse =
        error("unused")

    override suspend fun starred(): FerrotuneStarredResponse = error("unused")
    override suspend fun star(request: StarRequest) = error("unused")
    override suspend fun unstar(request: StarRequest) = error("unused")
    override suspend fun setRating(request: RatingRequest) = error("unused")

    override suspend fun home(params: Map<String, String>): HomePageResponse = error("unused")
    override suspend fun continueListening(
        params: Map<String, String>,
    ): HomeContinueListeningSection = error("unused")

    override suspend fun stats(): StatsResponse = error("unused")
    override suspend fun listeningStats(): ListeningStatsResponse = error("unused")
    override suspend fun periodReview(params: Map<String, String>): PeriodReviewResponse =
        error("unused")

    override suspend fun logListening(request: LogListeningRequest): LogListeningResponse =
        error("unused")

    override suspend fun playlistFolders(): PlaylistFoldersResponse = onPlaylistFolders()

    override suspend fun createPlaylistFolder(
        request: CreateFolderRequest,
    ): PlaylistFolderResponse = error("unused")

    override suspend fun updatePlaylistFolder(
        id: String,
        request: UpdateFolderRequest,
    ): PlaylistFolderResponse = onUpdateFolder(id, request)

    override suspend fun deletePlaylistFolder(id: String) = error("unused")

    override suspend fun importPlaylist(
        request: ImportPlaylistRequest,
    ): ImportPlaylistResponse = onImportPlaylist(request)

    override suspend fun playlistSongs(
        id: String,
        params: Map<String, String>,
    ): PlaylistSongsResponse = onPlaylistSongs(id, params)

    override suspend fun updatePlaylist(
        id: String,
        request: UpdatePlaylistRequest,
    ): PlaylistSongsResponse = error("unused")

    override suspend fun deletePlaylist(id: String) = error("unused")

    override suspend fun addPlaylistSongs(
        id: String,
        request: AddPlaylistSongsRequest,
    ): Unit = error("unused")

    override suspend fun removePlaylistSongs(
        id: String,
        request: RemovePlaylistSongsRequest,
    ) = onRemoveSongs(id, request)

    override suspend fun movePlaylist(id: String, request: MovePlaylistRequest) = error("unused")

    override suspend fun reorderPlaylistSongs(
        id: String,
        request: ReorderPlaylistRequest,
    ) = error("unused")

    override suspend fun movePlaylistEntry(
        id: String,
        request: MovePlaylistEntryRequest,
    ) = onMoveEntry(id, request)

    override suspend fun matchMissingEntry(id: String, request: MatchMissingEntryRequest) =
        error("unused")

    override suspend fun unmatchEntry(id: String, request: UnmatchEntryRequest) = error("unused")

    override suspend fun batchMatchEntries(
        id: String,
        request: BatchMatchEntriesRequest,
    ): BatchMatchEntriesResponse = error("unused")

    override suspend fun playlistsContainingSongs(
        songIds: List<String>,
    ): SongPlaylistsResponse = error("unused")

    override suspend fun playlistMembership(
        request: PlaylistMembershipRequest,
    ): PlaylistMembershipResponse = error("unused")

    override suspend fun recentlyPlayedPlaylists(): RecentPlaylistsResponse = error("unused")

    override suspend fun shareableUsers(): ShareableUsersResponse = error("unused")

    override suspend fun musicFolders(): MusicFoldersResponse = error("unused")

    override suspend fun preferences(): PreferencesResponse = error("unused")

    override suspend fun updatePreferences(
        request: UpdatePreferencesRequest,
    ): PreferencesResponse = error("unused")

    override suspend fun setPreference(
        key: String,
        request: SetPreferenceRequest,
    ): GetPreferenceResponse = error("unused")

    override suspend fun playlistShares(id: String): PlaylistSharesResponse = error("unused")

    override suspend fun setPlaylistShares(
        id: String,
        request: SetPlaylistSharesRequest,
    ): PlaylistSharesResponse = error("unused")

    override suspend fun transferPlaylistOwnership(
        id: String,
        request: TransferPlaylistOwnershipRequest,
    ) = error("unused")

    override suspend fun smartPlaylists(): SmartPlaylistsResponse = error("unused")
    override suspend fun smartPlaylist(id: String): SmartPlaylistInfo = error("unused")

    override suspend fun createSmartPlaylist(
        request: CreateSmartPlaylistRequest,
    ): CreateSmartPlaylistResponse = error("unused")

    override suspend fun updateSmartPlaylist(
        id: String,
        request: UpdateSmartPlaylistRequest,
    ): Unit = error("unused")

    override suspend fun deleteSmartPlaylist(id: String) = error("unused")

    override suspend fun smartPlaylistSongs(
        id: String,
        params: Map<String, String>,
    ): SmartPlaylistSongsResponse = onSmartPlaylistSongs(id, params)

    override suspend fun materializeSmartPlaylist(
        id: String,
        request: MaterializeSmartPlaylistRequest,
    ): MaterializeSmartPlaylistResponse = error("unused")
}
