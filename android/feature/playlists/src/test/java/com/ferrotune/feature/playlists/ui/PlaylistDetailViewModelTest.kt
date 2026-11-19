package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.core.testing.testServerPreferences
import com.ferrotune.feature.playlists.data.PlaylistRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaylistDetailViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(api: FakePreferencesApi = FakePreferencesApi()): PlaylistDetailViewModel {
        val provider = FakeApiProvider(api)
        return PlaylistDetailViewModel(
            repository = PlaylistRepository(provider),
            sessionStarter = FakePlaybackStarter(),
            viewSortPreferences = ViewSortPreferencesRepository(testServerPreferences(provider.api)),
            messages = UserMessages(),
            savedStateHandle = SavedStateHandle(mapOf("playlistId" to "pl-1")),
        )
    }

    @Test
    fun `defaults to custom order ascending`() {
        val state = viewModel().uiState.value

        assertEquals("custom", state.sort)
        assertEquals("asc", state.sortDir)
    }

    @Test
    fun `stored sort preference is applied on load`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"dateAdded","direction":"desc"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals("dateAdded", state.sort)
        assertEquals("desc", state.sortDir)
    }

    @Test
    fun `unsupported stored sort falls back to custom order`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"nonsense","direction":"sideways"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals("custom", state.sort)
        assertEquals("asc", state.sortDir)
    }

    @Test
    fun `sort changes are persisted for the account`() {
        val api = FakePreferencesApi()
        val viewModel = viewModel(api)

        viewModel.selectSort("name")
        viewModel.toggleSortDir()

        assertEquals(
            listOf(
                ViewSortKey.PLAYLIST_DETAIL.preferenceKey,
                ViewSortKey.PLAYLIST_DETAIL.preferenceKey,
            ),
            api.writtenKeys,
        )
        val stored = api.preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"name","direction":"desc"}""", stored.content)
    }

    private class EditablePlaylistApi(private val canEdit: Boolean) : FakePreferencesApi() {
        override suspend fun playlistSongs(id: String, params: Map<String, String>) = PlaylistSongsResponse(
            id = id, name = "Mix", owner = "sam", public = false, totalEntries = 0, matchedCount = 0,
            missingCount = 0, duration = 0, filteredCount = 0, created = "2026-01-01T00:00:00Z",
            changed = "2026-01-01T00:00:00Z", sharedWithMe = false, canEdit = canEdit, entries = emptyList(),
        )
    }

    @Test
    fun `reordering switches to custom order without a filter and persists the sort`() {
        val api = EditablePlaylistApi(canEdit = true)
        val viewModel = viewModel(api)
        viewModel.selectSort("name")
        viewModel.toggleSortDir()
        viewModel.setFilter("rock")

        viewModel.startReordering()

        val state = viewModel.uiState.value
        assertTrue(state.reordering)
        assertEquals("custom", state.sort)
        assertEquals("asc", state.sortDir)
        assertEquals("", state.filter)
        val stored = api.preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"custom","direction":"asc"}""", stored.content)

        viewModel.stopReordering()
        assertFalse(viewModel.uiState.value.reordering)
    }

    @Test
    fun `read-only playlists cannot enter reordering`() {
        val viewModel = viewModel(EditablePlaylistApi(canEdit = false))

        viewModel.startReordering()

        assertFalse(viewModel.uiState.value.reordering)
    }
}
