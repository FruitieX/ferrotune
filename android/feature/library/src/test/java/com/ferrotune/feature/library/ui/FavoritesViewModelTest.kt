package com.ferrotune.feature.library.ui

import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
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
class FavoritesViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(api: FakePreferencesApi = FakePreferencesApi()): FavoritesViewModel {
        val provider = FakeApiProvider(api)
        return FavoritesViewModel(
            repository = LibraryRepository(provider),
            sessionStarter = FakePlaybackStarter(),
            viewSortPreferences = ViewSortPreferencesRepository(provider),
        )
    }

    @Test
    fun `stored per-tab sort preferences are applied on load`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.FAVORITE_SONGS.preferenceKey] = JsonPrimitive(
                """{"field":"playCount","direction":"desc"}""",
            )
            preferenceValues[ViewSortKey.FAVORITE_ALBUMS.preferenceKey] = JsonPrimitive(
                """{"field":"year","direction":"desc"}""",
            )
            preferenceValues[ViewSortKey.FAVORITE_ARTISTS.preferenceKey] = JsonPrimitive(
                """{"field":"albumCount","direction":"desc"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals(SongSort.PLAY_COUNT, state.songSort)
        assertEquals(SortDir.DESC, state.songSortDir)
        assertEquals(AlbumSort.YEAR, state.albumSort)
        assertEquals(SortDir.DESC, state.albumSortDir)
        assertEquals(ArtistSort.ALBUM_COUNT, state.artistSort)
        assertEquals(SortDir.DESC, state.artistSortDir)
    }

    @Test
    fun `selectSort persists the active tab's preference`() {
        val api = FakePreferencesApi()
        val viewModel = viewModel(api)

        viewModel.selectTab(FavoritesTab.ALBUMS)
        viewModel.selectSort("year")

        assertEquals(AlbumSort.YEAR, viewModel.uiState.value.albumSort)
        assertEquals(listOf(ViewSortKey.FAVORITE_ALBUMS.preferenceKey), api.writtenKeys)
        val stored = api.preferenceValues[ViewSortKey.FAVORITE_ALBUMS.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"year","direction":"asc"}""", stored.content)
    }

    @Test
    fun `toggleSortDirection persists the active tab's preference`() {
        val api = FakePreferencesApi()
        val viewModel = viewModel(api)

        viewModel.toggleSortDirection()

        assertEquals(SortDir.DESC, viewModel.uiState.value.songSortDir)
        val stored = api.preferenceValues[ViewSortKey.FAVORITE_SONGS.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"name","direction":"desc"}""", stored.content)
    }

    @Test
    fun `unknown stored fields fall back to defaults`() {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.FAVORITE_SONGS.preferenceKey] = JsonPrimitive(
                """{"field":"nonsense","direction":"sideways"}""",
            )
        }

        val state = viewModel(api).uiState.value

        assertEquals(SongSort.TITLE, state.songSort)
        assertEquals(SortDir.ASC, state.songSortDir)
    }
}
