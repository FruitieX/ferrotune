package com.ferrotune.feature.home.ui

import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.ContinueListeningPlaylist
import com.ferrotune.core.network.generated.HomeAlbumSection
import com.ferrotune.core.network.generated.HomeContinueListeningSection
import com.ferrotune.core.network.generated.HomeForgottenFavoritesSection
import com.ferrotune.core.network.generated.HomePageResponse
import com.ferrotune.core.network.generated.HomeSongSection
import com.ferrotune.core.network.generated.PeriodReview
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.home.data.HomeRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

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

internal fun testAlbum(id: String, name: String = "Album $id"): AlbumResponse = AlbumResponse(
    id = id,
    name = name,
    artist = "Artist",
    artistId = "artist-1",
    songCount = 10,
    duration = 3600,
    created = "2026-01-01T00:00:00.000Z",
)

internal fun testHomePage(): HomePageResponse = HomePageResponse(
    continueListening = HomeContinueListeningSection(
        entries = listOf(
            ContinueListeningEntry(
                type = "album",
                lastPlayed = "2026-01-01T00:00:00.000Z",
                album = testAlbum("album-1", "Bloom"),
            ),
            ContinueListeningEntry(
                type = "playlist",
                lastPlayed = "2026-01-01T00:00:00.000Z",
                playlist = ContinueListeningPlaylist(
                    id = "playlist-1",
                    name = "Road trip",
                    playlistType = "playlist",
                ),
            ),
        ),
        total = 2,
    ),
    mostPlayedRecently = HomeSongSection(song = listOf(testSong("song-1")), total = 1),
    recentlyAdded = HomeAlbumSection(album = listOf(testAlbum("album-2")), total = 1),
    forgottenFavorites = HomeForgottenFavoritesSection(
        song = listOf(testSong("song-2")),
        total = 1,
        seed = 42,
    ),
    discover = HomeAlbumSection(album = listOf(testAlbum("album-3")), total = 1),
    similarTracks = HomeSongSection(song = listOf(testSong("song-3")), total = 1),
)

internal class FakeHomeApi(
    private val page: HomePageResponse = testHomePage(),
    private val review: PeriodReviewResponse = testReviewResponse(),
) : FakeFerrotuneApi() {
    var homeParams: Map<String, String>? = null
    var reviewParams: Map<String, String>? = null

    override suspend fun home(params: Map<String, String>): HomePageResponse {
        homeParams = params
        return page
    }

    override suspend fun periodReview(params: Map<String, String>): PeriodReviewResponse {
        reviewParams = params
        return review
    }
}

internal fun testReviewResponse(): PeriodReviewResponse = PeriodReviewResponse(
    review = PeriodReview(
        year = 2026,
        month = 1,
        totalListeningSecs = 3600,
        totalPlayCount = 10,
        uniqueTracks = 5,
        uniqueAlbums = 2,
        uniqueArtists = 1,
        topArtists = emptyList(),
        topAlbums = emptyList(),
        topTracks = emptyList(),
    ),
    availablePeriods = listOf(
        AvailablePeriod(year = 2026, month = null, hasData = true),
        AvailablePeriod(year = 2026, month = 1, hasData = true),
    ),
)

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: FakeHomeApi = FakeHomeApi(),
        starter: FakePlaybackStarter = FakePlaybackStarter(),
    ) = HomeViewModel(HomeRepository(FakeApiProvider(api)), starter)

    @Test
    fun `load populates sections and server url`() {
        val api = FakeHomeApi()

        val viewModel = viewModel(api)

        assertEquals(2, viewModel.uiState.value.page?.continueListening?.entries?.size)
        assertEquals("http://localhost:4040", viewModel.uiState.value.serverUrl)
        assertEquals("15", api.homeParams?.get("size"))
        assertEquals("medium", api.homeParams?.get("inlineImages"))
    }

    @Test
    fun `playContinueListening starts album and playlist queues`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        val entries = viewModel.uiState.value.page!!.continueListening.entries

        viewModel.playContinueListening(entries[0])
        viewModel.playContinueListening(entries[1])

        assertEquals("album", starter.specs[0].sourceType)
        assertEquals("album-1", starter.specs[0].sourceId)
        assertEquals("playlist", starter.specs[1].sourceType)
        assertEquals("playlist-1", starter.specs[1].sourceId)
    }

    @Test
    fun `playSection uses the section source type and start song`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        val song = viewModel.uiState.value.page!!.mostPlayedRecently.song.single()

        viewModel.playSection(HomeViewModel.SOURCE_TYPE_MOST_PLAYED, "Most played", song)

        val spec = starter.specs.single()
        assertEquals("mostPlayedRecently", spec.sourceType)
        assertEquals("song-1", spec.startSongId)
        assertNull(spec.sourceId)
    }

    @Test
    fun `playback failure surfaces an error`() {
        val viewModel = viewModel(starter = FakePlaybackStarter(failure = "offline"))
        val song = viewModel.uiState.value.page!!.similarTracks.song.single()

        viewModel.playSection(HomeViewModel.SOURCE_TYPE_SIMILAR_TRACKS, "Similar", song)

        assertEquals("offline", viewModel.uiState.value.playbackError)
    }
}
