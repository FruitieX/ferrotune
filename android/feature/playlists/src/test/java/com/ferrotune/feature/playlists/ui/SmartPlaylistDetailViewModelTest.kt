package com.ferrotune.feature.playlists.ui

import com.ferrotune.core.actions.UserMessages
import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.FakePreferencesApi
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
class SmartPlaylistDetailViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: FakePreferencesApi = FakePreferencesApi(),
    ): SmartPlaylistDetailViewModel {
        val provider = FakeApiProvider(api)
        return SmartPlaylistDetailViewModel(
            repository = PlaylistRepository(provider),
            sessionStarter = FakePlaybackStarter(),
            viewSortPreferences = ViewSortPreferencesRepository(provider),
            messages = UserMessages(),
            savedStateHandle = SavedStateHandle(mapOf("smartPlaylistId" to "sp-1")),
        )
    }

    @Test
    fun `shares the playlist sort preference with regular playlists`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"duration","direction":"desc"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals("duration", state.sort)
        assertEquals("desc", state.sortDir)
    }

    @Test
    fun `sort changes are persisted for the account`() {
        val api = FakePreferencesApi()
        val viewModel = viewModel(api)

        viewModel.selectSort("artist")
        viewModel.toggleSortDir()

        val stored = api.preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"artist","direction":"desc"}""", stored.content)
    }
}
