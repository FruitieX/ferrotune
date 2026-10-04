package com.ferrotune.feature.playlists.ui

import com.ferrotune.core.actions.UserMessages
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

    private fun playlist(id: String, name: String, folderId: String? = null, songCount: Long = 0) = PlaylistInFolder(
        id = id,
        name = name,
        folderId = folderId,
        owner = "tester",
        public = false,
        position = 0,
        songCount = songCount,
        duration = 0,
        sharedWithMe = false,
        canEdit = true,
        created = "2026-01-01T00:00:00.000Z",
        changed = "2026-01-01T00:00:00.000Z",
    )

    private fun viewModel(
        api: FakeBrowseApi = FakeBrowseApi(),
        starter: FakePlaybackStarter = FakePlaybackStarter(),
    ) = PlaylistsViewModel(
        repository = PlaylistRepository(FakeApiProvider(api)),
        sessionStarter = starter,
        messages = UserMessages(),
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

    @Test
    fun `browser lists folders first, then playlists filtered and sorted by name`() {
        val viewModel = viewModel(
            FakeBrowseApi(
                folders = listOf(folder("f", name = "Zeta folder")),
                playlists = listOf(playlist("2", "beta"), playlist("1", "Alpha"), playlist("3", "Gamma")),
            ),
        )

        assertEquals(
            listOf("folder-f", "playlist-1", "playlist-2", "playlist-3"),
            viewModel.uiState.value.browserItems().map { it.key },
        )

        viewModel.setFilter("a")
        viewModel.toggleSortDirection()

        assertEquals(
            listOf("folder-f", "playlist-3", "playlist-2", "playlist-1"),
            viewModel.uiState.value.browserItems().map { it.key },
        )
    }

    @Test
    fun `play all queues every playlist in the open folder as sources`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(
            FakeBrowseApi(
                folders = listOf(folder("f", name = "Mixes")),
                playlists = listOf(playlist("1", "One", folderId = "f"), playlist("2", "Two", folderId = "f")),
            ),
            starter,
        )
        viewModel.openFolder("f")

        viewModel.playAll(shuffle = true)

        val spec = starter.specs.single()
        assertEquals("Mixes", spec.sourceName)
        assertEquals(true, spec.shuffle)
        assertEquals(listOf("1", "2"), spec.sources.map { it.sourceId })
    }
}
