package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.network.generated.CreateSmartPlaylistRequest
import com.ferrotune.core.network.generated.CreateSmartPlaylistResponse
import com.ferrotune.core.network.generated.MusicFolderInfo
import com.ferrotune.core.network.generated.MusicFolderStats
import com.ferrotune.core.network.generated.MusicFoldersResponse
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.network.generated.SmartPlaylistConditionApi
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SmartPlaylistRulesApi
import com.ferrotune.core.network.generated.UpdateSmartPlaylistRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.feature.playlists.data.PlaylistRepository
import com.ferrotune.feature.playlists.data.testPlaylistInFolder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeEditorApi(
    private val existing: SmartPlaylistInfo? = null,
) : FakeFerrotuneApi() {
    var created: CreateSmartPlaylistRequest? = null
    var updated: UpdateSmartPlaylistRequest? = null

    override suspend fun playlistFolders() = PlaylistFoldersResponse(
        folders = listOf(
            PlaylistFolderResponse(
                id = "folder-1",
                name = "Sets",
                position = 0,
                createdAt = "2026-01-01T00:00:00.000Z",
                hasCoverArt = false,
            ),
        ),
        playlists = listOf(testPlaylistInFolder("playlist-1", "Chill")),
    )

    override suspend fun musicFolders() = MusicFoldersResponse(
        musicFolders = listOf(
            MusicFolderInfo(
                id = 1,
                name = "Main",
                path = "/music",
                enabled = true,
                watchEnabled = true,
                stats = MusicFolderStats(
                    songCount = 0,
                    albumCount = 0,
                    artistCount = 0,
                    totalDurationSeconds = 0,
                    totalSizeBytes = 0,
                ),
            ),
            MusicFolderInfo(
                id = 2,
                name = "Archive",
                path = "/archive",
                enabled = true,
                watchEnabled = true,
                stats = MusicFolderStats(
                    songCount = 0,
                    albumCount = 0,
                    artistCount = 0,
                    totalDurationSeconds = 0,
                    totalSizeBytes = 0,
                ),
            ),
        ),
    )

    override suspend fun smartPlaylist(id: String): SmartPlaylistInfo = requireNotNull(existing)

    override suspend fun createSmartPlaylist(
        request: CreateSmartPlaylistRequest,
    ): CreateSmartPlaylistResponse {
        created = request
        return CreateSmartPlaylistResponse(id = "smart-1", name = request.name)
    }

    override suspend fun updateSmartPlaylist(id: String, request: UpdateSmartPlaylistRequest) {
        updated = request
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SmartPlaylistEditorViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: FakeEditorApi = FakeEditorApi(),
        smartPlaylistId: String? = null,
    ) = SmartPlaylistEditorViewModel(
        PlaylistRepository(FakeApiProvider(api)),
        SavedStateHandle(
            smartPlaylistId?.let { mapOf("smartPlaylistId" to it) } ?: emptyMap(),
        ),
    )

    @Test
    fun `new playlist starts with a blank condition and dynamic fields`() {
        val viewModel = viewModel()

        val state = viewModel.uiState.value
        assertFalse(state.isEditing)
        assertFalse(state.canSave)
        assertEquals(1, state.conditions.size)
        assertEquals("artist", state.conditions.single().field)
        assertTrue(state.fields.any { it.apiName == "library" })
        assertTrue(state.fields.any { it.apiName == "inPlaylist" })
    }

    @Test
    fun `save builds the create request from the form state`() {
        val api = FakeEditorApi()
        val viewModel = viewModel(api)

        viewModel.setName("Rainy day")
        viewModel.setPublic(true)
        viewModel.setSortField("title")
        viewModel.setSortDirection("desc")
        viewModel.setMaxSongs("25")
        viewModel.changeConditionField(viewModel.uiState.value.conditions.single().id, "title")
        viewModel.updateCondition(
            viewModel.uiState.value.conditions.single().copy(text = "rain"),
        )
        viewModel.addCondition()
        viewModel.updateCondition(
            viewModel.uiState.value.conditions.last().copy(
                field = "starred",
                operator = "eq",
                boolean = true,
            ),
        )

        assertTrue(viewModel.uiState.value.canSave)
        viewModel.save()

        val request = requireNotNull(api.created)
        assertEquals("Rainy day", request.name)
        assertEquals(true, request.isPublic)
        assertEquals("title", request.sortField)
        assertEquals("desc", request.sortDirection)
        assertEquals(25L, request.maxSongs)
        assertEquals("and", request.rules.logic)
        assertEquals(2, request.rules.conditions.size)
        assertEquals("title", request.rules.conditions[0].field)
        assertEquals(JsonPrimitive("rain"), request.rules.conditions[0].value)
        assertEquals("starred", request.rules.conditions[1].field)
        assertEquals(JsonPrimitive(true), request.rules.conditions[1].value)
        assertTrue(viewModel.uiState.value.saved)
    }

    @Test
    fun `incomplete conditions block saving`() {
        val viewModel = viewModel()
        viewModel.setName("Rainy day")

        val condition = viewModel.uiState.value.conditions.single().id
        viewModel.changeConditionField(condition, "year")

        assertFalse(viewModel.uiState.value.canSave)

        viewModel.updateCondition(
            viewModel.uiState.value.conditions.single().copy(number = "1990"),
        )

        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `editing loads the stored rules and sends tri-state updates`() {
        val api = FakeEditorApi(
            existing = SmartPlaylistInfo(
                id = "smart-1",
                name = "Long songs",
                comment = "epics",
                isPublic = true,
                rules = SmartPlaylistRulesApi(
                    conditions = listOf(
                        SmartPlaylistConditionApi("duration", "gte", JsonPrimitive(420)),
                    ),
                    logic = "or",
                ),
                sortField = "duration",
                sortDirection = "desc",
                maxSongs = 50,
                folderId = "folder-1",
                songCount = 3,
                createdAt = "2026-01-01T00:00:00.000Z",
                updatedAt = "2026-01-01T00:00:00.000Z",
            ),
        )
        val viewModel = viewModel(api, smartPlaylistId = "smart-1")

        val loaded = viewModel.uiState.value
        assertTrue(loaded.isEditing)
        assertEquals("Long songs", loaded.name)
        assertEquals("or", loaded.logic)
        assertEquals("50", loaded.maxSongs)
        assertEquals("folder-1", loaded.folderId)
        assertEquals("duration", loaded.conditions.single().field)
        assertEquals("420", loaded.conditions.single().number)

        viewModel.setMaxSongs("")
        viewModel.setFolderId(null)
        viewModel.save()

        val request = requireNotNull(api.updated)
        assertEquals(JsonNull, request.maxSongs)
        assertEquals(JsonNull, request.folderId)
        assertEquals("Long songs", request.name)
    }
}
