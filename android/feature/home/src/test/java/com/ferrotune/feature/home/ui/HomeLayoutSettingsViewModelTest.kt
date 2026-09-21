package com.ferrotune.feature.home.ui

import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SmartPlaylistRulesApi
import com.ferrotune.core.network.generated.SmartPlaylistsResponse
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.testAccount
import com.ferrotune.feature.home.data.DEFAULT_HOME_SECTIONS
import com.ferrotune.feature.home.data.DEFAULT_HOME_TILES
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.home.data.HomePlaylistChoicesRepository
import com.ferrotune.feature.home.data.HomePlaylistType
import com.ferrotune.feature.home.data.HomeTileActionMode
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeTileKind
import com.ferrotune.feature.home.data.createHomeTile
import com.ferrotune.feature.home.data.createPlaylistHomeSection
import com.ferrotune.feature.home.data.parseHomeSections
import com.ferrotune.feature.home.data.parseHomeTiles
import com.ferrotune.feature.playlists.data.PlaylistRepository
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeLayoutSettingsViewModelTest {

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

    private class FakeLayoutApi(
        var folders: PlaylistFoldersResponse = PlaylistFoldersResponse(
            folders = emptyList(),
            playlists = emptyList(),
        ),
        var smart: SmartPlaylistsResponse = SmartPlaylistsResponse(smartPlaylists = emptyList()),
    ) : FakeFerrotuneApi() {
        val preferenceValues = mutableMapOf<String, JsonElement>()
        var failWrites = false

        override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
            accentColor = "default",
            preferences = preferenceValues.toMap(),
        )

        override suspend fun setPreference(
            key: String,
            request: SetPreferenceRequest,
        ): GetPreferenceResponse {
            if (failWrites) throw IOException("offline")
            preferenceValues[key] = request.value
            return GetPreferenceResponse(key = key, value = request.value)
        }

        override suspend fun playlistFolders(): PlaylistFoldersResponse = folders

        override suspend fun smartPlaylists(): SmartPlaylistsResponse = smart
    }

    private fun viewModel(
        api: FakeLayoutApi = FakeLayoutApi(),
        accounts: FakeAccounts = FakeAccounts(listOf(testAccount()), testAccount().id),
    ): HomeLayoutSettingsViewModel {
        val provider = FakeApiProvider(api)
        return HomeLayoutSettingsViewModel(
            layoutRepository = HomeLayoutPreferencesRepository(provider),
            choicesRepository = HomePlaylistChoicesRepository(PlaylistRepository(provider)),
            accounts = accounts,
        ).also { mainDispatcher.scheduler.advanceUntilIdle() }
    }

    @Test
    fun `load exposes default tiles and sections`() {
        val viewModel = viewModel()

        assertEquals(DEFAULT_HOME_TILES, viewModel.uiState.value.tiles)
        assertEquals(DEFAULT_HOME_SECTIONS, viewModel.uiState.value.sections)
    }

    @Test
    fun `load exposes playlist choices`() {
        val api = FakeLayoutApi(
            folders = PlaylistFoldersResponse(
                folders = emptyList(),
                playlists = listOf(testPlaylistInFolder("playlist-1", "Road trip")),
            ),
            smart = SmartPlaylistsResponse(
                smartPlaylists = listOf(testSmartPlaylist("smart-1", "Fresh")),
            ),
        )

        val viewModel = viewModel(api)

        val choices = viewModel.uiState.value.playlistChoices
        assertEquals(2, choices.size)
        assertEquals("playlist-1", choices[0].id)
        assertEquals(HomePlaylistType.PLAYLIST, choices[0].type)
        assertEquals("Road trip", homePlaylistChoiceLabel(choices[0]))
        assertEquals(HomePlaylistType.SMART_PLAYLIST, choices[1].type)
        assertEquals("Fresh (smart)", homePlaylistChoiceLabel(choices[1]))
    }

    @Test
    fun `add and update tile persist home-tiles-v1`() {
        val api = FakeLayoutApi()
        val viewModel = viewModel(api)
        val tile = createHomeTile(HomeTileKind.RECENTLY_ADDED)

        viewModel.addTile(tile)
        viewModel.updateTile(tile.copy(action = HomeTileActionMode.SHUFFLE))

        val persisted = api.preferenceValues[HomeLayoutPreferencesRepository.KEY_TILES] as JsonArray
        val tiles = parseHomeTiles(persisted)
        assertEquals(3, tiles.size)
        assertEquals(HomeTileKind.RECENTLY_ADDED, tiles.last().kind)
        assertEquals(
            HomeTileActionMode.SHUFFLE,
            tiles.last().action,
        )
    }

    @Test
    fun `move and remove tile reorder and persist`() {
        val api = FakeLayoutApi()
        val viewModel = viewModel(api)
        val first = viewModel.uiState.value.tiles.first()

        viewModel.moveTile(first.id, 1)
        assertEquals(
            listOf("history", "favorites"),
            viewModel.uiState.value.tiles.map { it.id },
        )

        viewModel.removeTile("favorites")
        assertEquals(listOf("history"), viewModel.uiState.value.tiles.map { it.id })
        val persisted = api.preferenceValues[HomeLayoutPreferencesRepository.KEY_TILES] as JsonArray
        assertEquals(1, parseHomeTiles(persisted).size)
    }

    @Test
    fun `section enable toggle persists normalized sections`() {
        val api = FakeLayoutApi()
        val viewModel = viewModel(api)

        viewModel.setSectionEnabled("continue-listening", false)

        val persisted = api.preferenceValues[HomeLayoutPreferencesRepository.KEY_SECTIONS] as JsonArray
        val sections = parseHomeSections(persisted)
        val continueListening = sections.first { it.kind == HomeSectionKind.CONTINUE_LISTENING }
        assertEquals(false, continueListening.enabled)
    }

    @Test
    fun `playlist section can be added configured and removed`() {
        val api = FakeLayoutApi()
        val viewModel = viewModel(api)

        val section = createPlaylistHomeSection()
        viewModel.addSection(section)
        val added = viewModel.uiState.value.sections.last()
        assertEquals(HomeSectionKind.PLAYLIST_SONGS, added.kind)
        assertNull(added.playlistId)

        viewModel.updateSection(
            added.copy(
                playlistId = "playlist-1",
                playlistName = "Road trip",
                playlistType = HomePlaylistType.PLAYLIST,
            ),
        )
        val configured = viewModel.uiState.value.sections.last()
        assertEquals("playlist-1", configured.playlistId)

        val persisted = api.preferenceValues[HomeLayoutPreferencesRepository.KEY_SECTIONS] as JsonArray
        val stored = parseHomeSections(persisted)
        assertTrue(
            stored.any { it.kind == HomeSectionKind.PLAYLIST_SONGS && it.playlistId == "playlist-1" },
        )

        viewModel.removeSection(configured.id)
        assertTrue(
            viewModel.uiState.value.sections.none {
                it.kind == HomeSectionKind.PLAYLIST_SONGS && it.id == configured.id
            },
        )
    }

    @Test
    fun `accounts are exposed for the account picker`() {
        val viewModel = viewModel()

        assertEquals(listOf("test"), viewModel.uiState.value.accounts.map { it.id })
    }

    @Test
    fun `persist failure surfaces a message`() {
        val api = FakeLayoutApi().apply { failWrites = true }
        val viewModel = viewModel(api)

        viewModel.addTile(createHomeTile(HomeTileKind.DISCOVER))

        assertNotNull(viewModel.uiState.value.message)
    }
}

internal fun testPlaylistInFolder(id: String, name: String): PlaylistInFolder = PlaylistInFolder(
    id = id,
    name = name,
    owner = "tester",
    public = false,
    position = 0,
    songCount = 3,
    duration = 300,
    sharedWithMe = false,
    canEdit = true,
    created = "2026-01-01T00:00:00.000Z",
    changed = "2026-01-01T00:00:00.000Z",
)

internal fun testSmartPlaylist(id: String, name: String): SmartPlaylistInfo = SmartPlaylistInfo(
    id = id,
    name = name,
    isPublic = false,
    rules = SmartPlaylistRulesApi(conditions = emptyList(), logic = "and"),
    createdAt = "2026-01-01T00:00:00.000Z",
    updatedAt = "2026-01-01T00:00:00.000Z",
)
