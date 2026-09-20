package com.ferrotune.feature.library

import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.FerrotuneApi
import com.ferrotune.core.network.FerrotuneApiProvider
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
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse

internal fun testAccount(): Account = Account(
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

internal fun testSong(id: String, title: String = "Song $id"): SongResponse = SongResponse(
    id = id,
    title = title,
    artist = "Artist",
    artistId = "artist-1",
    size = 1024,
    contentType = "audio/flac",
    suffix = "flac",
    duration = 1000,
    path = "Artist/Album/$id.flac",
    created = "2026-01-01T00:00:00.000Z",
    type = "music",
)

internal class FakeApiProvider(
    val api: FerrotuneApi,
    private val account: Account = testAccount(),
) : FerrotuneApiProvider {
    override suspend fun requireApi(): FerrotuneApi = api

    override suspend fun requireAccount(): Account = account
}

internal class FakePlaybackStarter(private val failure: String? = null) : PlaybackStarter {
    val specs = mutableListOf<QueueStartSpec>()
    val albumStarts = mutableListOf<AlbumStart>()

    override suspend fun startQueue(spec: QueueStartSpec) {
        failure?.let { throw IllegalStateException(it) }
        specs += spec
    }

    override suspend fun startRandomQueue(size: Int) = Unit

    override suspend fun startSongRadio(
        seedSongId: String,
        sourceName: String?,
        startSongId: String?,
    ) = Unit

    override suspend fun startAlbum(
        albumId: String,
        sourceName: String?,
        startSongId: String?,
    ) {
        albumStarts += AlbumStart(albumId, sourceName, startSongId)
    }

    override suspend fun startArtist(
        artistId: String,
        sourceName: String?,
        startSongId: String?,
    ) = Unit
}

internal data class AlbumStart(
    val albumId: String,
    val sourceName: String?,
    val startSongId: String?,
)

internal class FakeFerrotuneApi(
    val onSearch: (Map<String, String>) -> FerrotuneSearchResponse = { error("unused") },
    val onGenres: () -> FerrotuneGenresResponse = { error("unused") },
    val onAlbum: (String) -> FerrotuneAlbumResponse = { error("unused") },
) : FerrotuneApi {
    override suspend fun login(request: AuthLoginRequest): AuthLoginResponseDto = error("unused")
    override suspend fun me(): AuthMeResponseDto = error("unused")
    override suspend fun refresh(): AuthSessionRefreshResponseDto = error("unused")
    override suspend fun logout() = error("unused")
    override suspend fun connectSession(request: ConnectSessionRequest): ConnectSessionResponse =
        error("unused")

    override suspend fun startQueue(request: StartQueueRequest): StartQueueResponse = error("unused")
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
}
