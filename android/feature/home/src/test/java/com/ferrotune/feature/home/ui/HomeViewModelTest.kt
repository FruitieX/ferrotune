package com.ferrotune.feature.home.ui

import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.ContinueListeningPlaylist
import com.ferrotune.core.network.generated.DiscoveryResponse
import com.ferrotune.core.network.generated.FerrotuneAlbumListResponse
import com.ferrotune.core.network.generated.HomeContinueListeningSection
import com.ferrotune.core.network.generated.HomeForgottenFavoritesSection
import com.ferrotune.core.network.generated.MostPlayedRecentlyResponse
import com.ferrotune.core.network.generated.PeriodReview
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SmartPlaylistSongsResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.testing.FakeAccountSwitcher
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.testAccount
import com.ferrotune.feature.home.data.DEFAULT_HOME_SECTIONS
import com.ferrotune.feature.home.data.DEFAULT_HOME_TILES
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.home.data.HomePlaylistType
import com.ferrotune.feature.home.data.HomeRepository
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeSectionLoader
import com.ferrotune.feature.home.data.HomeTileConfig
import com.ferrotune.feature.home.data.HomeTileKind
import com.ferrotune.feature.home.data.encodeHomeSections
import com.ferrotune.feature.home.data.encodeHomeTiles
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

internal fun testContinueListening(): List<ContinueListeningEntry> = listOf(
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
)

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

internal class FakeHomeApi(
    private val tiles: List<HomeTileConfig> = DEFAULT_HOME_TILES,
    private val sections: List<HomeSectionConfig> = DEFAULT_HOME_SECTIONS,
    private val review: PeriodReviewResponse = testReviewResponse(),
) : FakeFerrotuneApi() {
    var continueListeningCalls = 0
    var mostPlayedParams: Map<String, String>? = null
    var forgottenParams: Map<String, String>? = null
    val albumParams = mutableListOf<Map<String, String>>()
    var similarTracksParams: Map<String, String>? = null
    var playlistSongsId: String? = null
    var playlistSongsParams: Map<String, String>? = null
    var smartPlaylistSongsId: String? = null
    var reviewParams: Map<String, String>? = null

    override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
        accentColor = "default",
        preferences = mapOf(
            HomeLayoutPreferencesRepository.KEY_TILES to encodeHomeTiles(tiles),
            HomeLayoutPreferencesRepository.KEY_SECTIONS to encodeHomeSections(sections),
        ),
    )

    override suspend fun continueListening(
        params: Map<String, String>,
    ): HomeContinueListeningSection {
        continueListeningCalls++
        return HomeContinueListeningSection(entries = testContinueListening(), total = 2)
    }

    override suspend fun mostPlayedRecently(
        params: Map<String, String>,
    ): MostPlayedRecentlyResponse {
        mostPlayedParams = params
        return MostPlayedRecentlyResponse(song = listOf(testSong("song-1")), total = 1)
    }

    override suspend fun forgottenFavorites(
        params: Map<String, String>,
    ): HomeForgottenFavoritesSection {
        forgottenParams = params
        return HomeForgottenFavoritesSection(
            song = listOf(testSong("song-2")),
            total = 1,
            seed = 42,
        )
    }

    override suspend fun albums(params: Map<String, String>): FerrotuneAlbumListResponse {
        albumParams.add(params)
        return FerrotuneAlbumListResponse(
            album = listOf(testAlbum("album-${params["type"]}")),
            total = 1,
            seed = 7,
        )
    }

    override suspend fun discoverySimilarSongs(params: Map<String, String>): DiscoveryResponse {
        similarTracksParams = params
        return DiscoveryResponse(
            song = listOf(testSong("song-3")),
            total = 1,
            seed = 1,
            count = 1,
            excludeRecentDays = 0,
        )
    }

    override suspend fun playlistSongs(
        id: String,
        params: Map<String, String>,
    ): PlaylistSongsResponse {
        playlistSongsId = id
        playlistSongsParams = params
        return PlaylistSongsResponse(
            id = id,
            name = "Road trip",
            owner = "tester",
            public = false,
            totalEntries = 1,
            matchedCount = 1,
            missingCount = 0,
            duration = 1000,
            filteredCount = 1,
            created = "2026-01-01T00:00:00.000Z",
            changed = "2026-01-01T00:00:00.000Z",
            sharedWithMe = false,
            canEdit = true,
            entries = listOf(
                PlaylistSongEntry(
                    entryId = "entry-1",
                    position = 0,
                    entryType = "song",
                    song = testSong("song-4"),
                ),
            ),
        )
    }

    override suspend fun smartPlaylistSongs(
        id: String,
        params: Map<String, String>,
    ): SmartPlaylistSongsResponse {
        smartPlaylistSongsId = id
        return SmartPlaylistSongsResponse(
            id = id,
            name = "Smart",
            totalCount = 1,
            totalDuration = 1000,
            offset = 0,
            songs = listOf(testSong("song-5")),
        )
    }

    override suspend fun periodReview(params: Map<String, String>): PeriodReviewResponse {
        reviewParams = params
        return review
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    private lateinit var mainDispatcher: TestDispatcher

    @Before
    fun setUp() {
        mainDispatcher = UnconfinedTestDispatcher()
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun drain() = mainDispatcher.scheduler.advanceUntilIdle()

    private fun viewModel(
        api: FakeHomeApi = FakeHomeApi(),
        starter: FakePlaybackStarter = FakePlaybackStarter(),
        switcher: FakeAccountSwitcher = FakeAccountSwitcher(),
    ): HomeViewModel {
        val provider = FakeApiProvider(api)
        val account = testAccount()
        return HomeViewModel(
            repository = HomeRepository(provider),
            layoutRepository = HomeLayoutPreferencesRepository(provider),
            sectionLoader = HomeSectionLoader(HomeRepository(provider)),
            sessionStarter = starter,
            accounts = FakeAccounts(listOf(account), account.id),
            accountSwitcher = switcher,
        ).also { drain() }
    }

    @Test
    fun `load populates tiles, sections, and server url`() {
        val api = FakeHomeApi()

        val viewModel = viewModel(api)
        val state = viewModel.uiState.value

        assertEquals("http://localhost:4040", state.serverUrl)
        assertEquals(2, state.tiles.size)
        assertEquals(1, api.continueListeningCalls)
        assertEquals("15", api.mostPlayedParams?.get("size"))
        assertEquals("medium", api.mostPlayedParams?.get("inlineImages"))
        val continueListening = state.sections
            .first { it.config.kind == HomeSectionKind.CONTINUE_LISTENING }
        assertEquals(2, continueListening.entries.size)
        val mostPlayed = state.sections
            .first { it.config.kind == HomeSectionKind.MOST_PLAYED_RECENTLY }
        assertEquals(1, mostPlayed.songs.size)
    }

    @Test
    fun `most played recently uses the configured period`() {
        val api = FakeHomeApi(
            sections = listOf(
                HomeSectionConfig(
                    id = "most-played-recently",
                    kind = HomeSectionKind.MOST_PLAYED_RECENTLY,
                    mostPlayedRecentlyDays = 7,
                ),
            ),
        )

        viewModel(api)

        val since = api.mostPlayedParams?.get("since")
        assertNotNull(since)
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val expected = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
        assertTrue(abs(format.parse(since!!)!!.time - expected) < 60_000)
    }

    @Test
    fun `forgotten favorites uses the configured thresholds`() {
        val api = FakeHomeApi(
            sections = listOf(
                HomeSectionConfig(
                    id = "forgotten-favorites",
                    kind = HomeSectionKind.FORGOTTEN_FAVORITES,
                    forgottenFavoritesMinPlays = 5,
                    forgottenFavoritesNotPlayedSinceDays = 30,
                ),
            ),
        )

        viewModel(api)

        assertEquals("5", api.forgottenParams?.get("minPlays"))
        assertEquals("30", api.forgottenParams?.get("notPlayedSinceDays"))
    }

    @Test
    fun `disabled sections are skipped`() {
        val api = FakeHomeApi(
            sections = listOf(
                HomeSectionConfig(
                    id = "continue-listening",
                    kind = HomeSectionKind.CONTINUE_LISTENING,
                    enabled = false,
                ),
            ),
        )

        val viewModel = viewModel(api)
        val state = viewModel.uiState.value

        assertEquals(0, api.continueListeningCalls)
        assertNull(
            state.sections
                .firstOrNull { it.config.kind == HomeSectionKind.CONTINUE_LISTENING },
        )
    }

    @Test
    fun `playlist section loads its songs`() {
        val api = FakeHomeApi(
            sections = listOf(
                HomeSectionConfig(
                    id = "playlist-section",
                    kind = HomeSectionKind.PLAYLIST_SONGS,
                    playlistId = "playlist-1",
                    playlistName = "Road trip",
                    playlistType = HomePlaylistType.PLAYLIST,
                ),
            ),
        )

        val viewModel = viewModel(api)
        val state = viewModel.uiState.value

        assertEquals("playlist-1", api.playlistSongsId)
        val section = state.sections
            .first { it.config.kind == HomeSectionKind.PLAYLIST_SONGS }
        assertEquals(1, section.songs.size)
    }

    @Test
    fun `playSection starts the section queue with its filters`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        val section = viewModel.uiState.value.sections
            .first { it.config.kind == HomeSectionKind.MOST_PLAYED_RECENTLY }
            .config

        viewModel.playSection(section, shuffle = true)
        drain()

        val spec = starter.specs.single()
        assertEquals("mostPlayedRecently", spec.sourceType)
        assertNull(spec.sourceId)
        assertTrue(spec.shuffle)
        assertNotNull(spec.filters["since"])
    }

    @Test
    fun `playContinueListening starts album and playlist queues`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        val entries = viewModel.uiState.value.sections
            .first { it.config.kind == HomeSectionKind.CONTINUE_LISTENING }
            .entries

        viewModel.playContinueListening(entries[0])
        viewModel.playContinueListening(entries[1])
        drain()

        assertEquals("album", starter.specs[0].sourceType)
        assertEquals("album-1", starter.specs[0].sourceId)
        assertEquals("playlist", starter.specs[1].sourceType)
        assertEquals("playlist-1", starter.specs[1].sourceId)
    }

    @Test
    fun `playback failure surfaces an error`() {
        val viewModel = viewModel(starter = FakePlaybackStarter(failure = "offline"))
        val song = viewModel.uiState.value.sections
            .first { it.config.kind == HomeSectionKind.SIMILAR_TRACKS }
            .songs
            .single()

        viewModel.playSong("similarTracks", "Similar", song)
        drain()

        assertEquals("offline", viewModel.uiState.value.playbackError)
    }

    @Test
    fun `account switch tile delegates to the switcher`() {
        val switcher = FakeAccountSwitcher()
        val api = FakeHomeApi(
            tiles = listOf(
                HomeTileConfig(
                    id = "switch",
                    kind = HomeTileKind.ACCOUNT_SWITCH,
                    accountKey = "other@http://localhost:4040",
                    accountLabel = "Other",
                ),
            ),
        )

        val viewModel = viewModel(api, switcher = switcher)
        viewModel.onTileAction(viewModel.uiState.value.tiles.single().action)
        drain()

        assertEquals(listOf("other@http://localhost:4040"), switcher.switchedTo)
        assertNull(viewModel.uiState.value.switchError)
    }

    @Test
    fun `switch failure surfaces an error`() {
        val switcher = FakeAccountSwitcher(
            result = AccountSwitchResult.Failure("token expired"),
        )
        val api = FakeHomeApi(
            tiles = listOf(
                HomeTileConfig(
                    id = "switch",
                    kind = HomeTileKind.ACCOUNT_SWITCH,
                    accountKey = "other@http://localhost:4040",
                ),
            ),
        )

        val viewModel = viewModel(api, switcher = switcher)
        val state = viewModel.uiState.value
        viewModel.onTileAction(state.tiles.single().action)
        drain()

        assertEquals("token expired", viewModel.uiState.value.switchError)
    }
}
