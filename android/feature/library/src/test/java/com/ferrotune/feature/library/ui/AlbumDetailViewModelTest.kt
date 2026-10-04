package com.ferrotune.feature.library.ui

import com.ferrotune.core.actions.UserMessages
import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.network.generated.AlbumDetail
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SortDir
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AlbumDetailViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val album = AlbumDetail(
        id = "album-1",
        name = "Bloom",
        artist = "Beach House",
        artistId = "artist-1",
        songCount = 10,
        duration = 3600,
        created = "2026-01-01T00:00:00.000Z",
    )

    private fun preferencesApi(): FakePreferencesApi = object : FakePreferencesApi() {
        override suspend fun album(id: String): FerrotuneAlbumResponse =
            FerrotuneAlbumResponse(album)
    }

    private fun viewModel(
        starter: FakePlaybackStarter = FakePlaybackStarter(),
        api: FakePreferencesApi = preferencesApi(),
    ) = AlbumDetailViewModel(
        repository = LibraryRepository(FakeApiProvider(api)),
        sessionStarter = starter,
        viewSortPreferences = ViewSortPreferencesRepository(FakeApiProvider(api)),
        messages = UserMessages(),
        savedStateHandle = SavedStateHandle(mapOf("albumId" to "album-1")),
    )

    @Test
    fun `album loads from the saved state argument`() {
        val viewModel = viewModel()

        assertEquals("Bloom", viewModel.uiState.value.album?.name)
        assertEquals("http://localhost:4040", viewModel.uiState.value.serverUrl)
        assertFalse(viewModel.uiState.value.loading)
    }

    @Test
    fun `play forwards the album and start song to the session starter`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter)

        viewModel.play("song-7")

        val start = starter.specs.single()
        assertEquals("album", start.sourceType)
        assertEquals("album-1", start.sourceId)
        assertEquals("Bloom", start.sourceName)
        assertEquals("song-7", start.startSongId)
        assertEquals(false, start.shuffle)
    }

    @Test
    fun `shuffle starts the album queue shuffled`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter)

        viewModel.play(shuffle = true)

        assertEquals(true, starter.specs.single().shuffle)
    }

    @Test
    fun `stored sort preference is applied on load`() {
        val api = preferencesApi().apply {
            preferenceValues[ViewSortKey.ALBUM_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"year","direction":"desc"}""",
            )
        }

        val viewModel = viewModel(api = api)

        assertEquals("year", viewModel.uiState.value.sort)
        assertEquals(SortDir.DESC, viewModel.uiState.value.sortDir)
    }

    @Test
    fun `unsupported stored sort field falls back to custom order`() {
        val api = preferencesApi().apply {
            preferenceValues[ViewSortKey.ALBUM_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"playCount","direction":"sideways"}""",
            )
        }

        val viewModel = viewModel(api = api)

        assertEquals(CUSTOM_SORT, viewModel.uiState.value.sort)
        assertEquals(SortDir.ASC, viewModel.uiState.value.sortDir)
    }

    @Test
    fun `sort changes are persisted for the account`() {
        val api = preferencesApi()
        val viewModel = viewModel(api = api)

        viewModel.selectSort("artist")
        viewModel.toggleSortDir()

        assertEquals(
            listOf(
                ViewSortKey.ALBUM_DETAIL.preferenceKey,
                ViewSortKey.ALBUM_DETAIL.preferenceKey,
            ),
            api.writtenKeys,
        )
        val stored = api.preferenceValues[ViewSortKey.ALBUM_DETAIL.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"artist","direction":"desc"}""", stored.content)
    }
}
