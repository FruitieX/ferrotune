package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.network.ViewSortKey
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
}
