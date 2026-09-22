package com.ferrotune.feature.playlists.ui

import com.ferrotune.core.network.generated.AddPlaylistSongsRequest
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.feature.playlists.data.PlaylistRepository
import com.ferrotune.feature.playlists.data.testPlaylistInFolder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeAddApi : FakeFerrotuneApi() {
    var addedTo: String? = null
    var addedSongIds: List<String> = emptyList()

    override suspend fun playlistFolders() = PlaylistFoldersResponse(
        folders = emptyList(),
        playlists = listOf(
            testPlaylistInFolder("playlist-1", "Chill"),
            testPlaylistInFolder("playlist-2", "Workout"),
            testPlaylistInFolder("playlist-3", "Shared").copy(canEdit = false),
        ),
    )

    override suspend fun addPlaylistSongs(id: String, request: AddPlaylistSongsRequest) {
        addedTo = id
        addedSongIds = request.songIds
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class AddToPlaylistViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(api: FakeAddApi = FakeAddApi()) =
        AddToPlaylistViewModel(PlaylistRepository(FakeApiProvider(api)))

    @Test
    fun `only editable playlists are selectable`() {
        val viewModel = viewModel()

        val names = viewModel.uiState.value.visiblePlaylists.map { it.name }
        assertEquals(listOf("Chill", "Workout"), names)
    }

    @Test
    fun `search filters by name`() {
        val viewModel = viewModel()

        viewModel.setQuery("work")

        assertEquals(listOf("Workout"), viewModel.uiState.value.visiblePlaylists.map { it.name })
    }

    @Test
    fun `add sends the song ids to the chosen playlist`() {
        val api = FakeAddApi()
        val viewModel = viewModel(api)

        viewModel.add(listOf("song-1", "song-2"), "playlist-1")

        assertEquals("playlist-1", api.addedTo)
        assertEquals(listOf("song-1", "song-2"), api.addedSongIds)
        assertTrue(viewModel.uiState.value.added)
    }
}
