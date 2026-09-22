package com.ferrotune.feature.playlists.ui

import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistFoldersResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.RecentPlaylistsResponse
import com.ferrotune.core.network.generated.SmartPlaylistsResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.playlists.data.PlaylistRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

private class FakeBrowseApi(
    var folders: List<PlaylistFolderResponse> = emptyList(),
    var playlists: List<PlaylistInFolder> = emptyList(),
) : FakeFerrotuneApi() {
    override suspend fun playlistFolders() = PlaylistFoldersResponse(folders, playlists)

    override suspend fun recentlyPlayedPlaylists() = RecentPlaylistsResponse(emptyList())

    override suspend fun smartPlaylists() = SmartPlaylistsResponse(emptyList())
}

@OptIn(ExperimentalCoroutinesApi::class)
class PlaylistsViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun folder(
        id: String,
        name: String = "Folder $id",
        parentId: String? = null,
    ) = PlaylistFolderResponse(
        id = id,
        name = name,
        parentId = parentId,
        position = 0,
        createdAt = "2026-01-01T00:00:00.000Z",
        hasCoverArt = false,
    )

    private fun playlist(id: String, name: String) = PlaylistInFolder(
        id = id,
        name = name,
        owner = "tester",
        public = false,
        position = 0,
        songCount = 0,
        duration = 0,
        sharedWithMe = false,
        canEdit = true,
        created = "2026-01-01T00:00:00.000Z",
        changed = "2026-01-01T00:00:00.000Z",
    )

    private fun viewModel(api: FakeBrowseApi = FakeBrowseApi()) = PlaylistsViewModel(
        repository = PlaylistRepository(FakeApiProvider(api)),
        sessionStarter = FakePlaybackStarter(),
    )

    @Test
    fun `load builds the tree and starts at the root`() {
        val viewModel = viewModel(
            FakeBrowseApi(
                folders = listOf(folder("a"), folder("b", parentId = "a")),
                playlists = listOf(playlist("p1", "Root")),
            ),
        )

        val state = viewModel.uiState.value
        assertNull(state.currentFolderId)
        assertEquals(listOf("Root"), state.tree.rootPlaylists.map { it.name })
        assertEquals(listOf("a"), state.tree.folders.map { it.folder.id })
    }

    @Test
    fun `openFolder drills in and navigateUp returns to the parent`() {
        val viewModel = viewModel(
            FakeBrowseApi(folders = listOf(folder("a"), folder("b", parentId = "a"))),
        )

        viewModel.openFolder("a")
        assertEquals("a", viewModel.uiState.value.currentFolderId)

        viewModel.openFolder("b")
        assertEquals("b", viewModel.uiState.value.currentFolderId)

        viewModel.navigateUp()
        assertEquals("a", viewModel.uiState.value.currentFolderId)

        viewModel.navigateUp()
        assertNull(viewModel.uiState.value.currentFolderId)
    }

    @Test
    fun `navigateUp is a no-op at the root`() {
        val viewModel = viewModel()

        viewModel.navigateUp()

        assertNull(viewModel.uiState.value.currentFolderId)
    }

    @Test
    fun `reload keeps the open folder while it still exists`() {
        val api = FakeBrowseApi(folders = listOf(folder("a")))
        val viewModel = viewModel(api)
        viewModel.openFolder("a")

        viewModel.load()

        assertEquals("a", viewModel.uiState.value.currentFolderId)
    }

    @Test
    fun `reload resets the open folder when it disappears`() {
        val api = FakeBrowseApi(folders = listOf(folder("a")))
        val viewModel = viewModel(api)
        viewModel.openFolder("a")

        api.folders = emptyList()
        viewModel.load()

        assertNull(viewModel.uiState.value.currentFolderId)
    }
}
