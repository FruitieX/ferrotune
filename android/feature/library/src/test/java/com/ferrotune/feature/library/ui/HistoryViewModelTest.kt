package com.ferrotune.feature.library.ui

import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
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
class HistoryViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(api: FakePreferencesApi = FakePreferencesApi()): HistoryViewModel {
        val provider = FakeApiProvider(api)
        return HistoryViewModel(
            repository = LibraryRepository(provider),
            sessionStarter = FakePlaybackStarter(),
            viewSortPreferences = ViewSortPreferencesRepository(provider),
            messages = UserMessages(),
        )
    }

    @Test
    fun `defaults to last played descending`() {
        val state = viewModel().uiState.value

        assertEquals(SongSort.LAST_PLAYED, state.songSort)
        assertEquals(SortDir.DESC, state.songSortDir)
    }

    @Test
    fun `stored sort preference is applied on load`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.HISTORY.preferenceKey] = JsonPrimitive(
                """{"field":"playCount","direction":"asc"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals(SongSort.PLAY_COUNT, state.songSort)
        assertEquals(SortDir.ASC, state.songSortDir)
    }

    @Test
    fun `sort changes are persisted for the account`() {
        val api = FakePreferencesApi()
        val viewModel = viewModel(api)

        viewModel.selectSort("duration")
        viewModel.toggleSortDirection()

        assertEquals(
            listOf(ViewSortKey.HISTORY.preferenceKey, ViewSortKey.HISTORY.preferenceKey),
            api.writtenKeys,
        )
        val stored = api.preferenceValues[ViewSortKey.HISTORY.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"duration","direction":"asc"}""", stored.content)
    }
}
