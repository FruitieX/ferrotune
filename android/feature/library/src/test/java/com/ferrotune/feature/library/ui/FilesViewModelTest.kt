package com.ferrotune.feature.library.ui

import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.network.generated.BreadcrumbItem
import com.ferrotune.core.network.generated.DirectoryChildPaged
import com.ferrotune.core.network.generated.DirectoryPagedResponse
import com.ferrotune.core.network.generated.LibrariesResponse
import com.ferrotune.core.network.generated.LibraryInfo
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.testServerPreferences
import com.ferrotune.feature.library.data.LibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeFilesApi : FakeFerrotuneApi() {
    var librariesCalls = 0

    override suspend fun libraries(): LibrariesResponse {
        librariesCalls++
        return LibrariesResponse(
            listOf(LibraryInfo(1, "Music", songCount = 10, totalSize = 1000), LibraryInfo(2, "Podcasts", 2, 50)),
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class FilesViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(api: FakeFilesApi = FakeFilesApi(), starter: FakePlaybackStarter = FakePlaybackStarter()) =
        FilesViewModel(
            LibraryRepository(FakeApiProvider(api)),
            starter,
            ViewSortPreferencesRepository(testServerPreferences(api)),
            UserMessages(),
        )

    private fun listing(name: String, folders: Long) = DirectoryPagedResponse(
        libraryId = 1,
        libraryName = "Music",
        path = "Rock/$name",
        name = name,
        total = folders + 3,
        folderCount = folders,
        fileCount = 3,
        totalSize = 100,
        children = emptyList(),
        breadcrumbs = listOf(BreadcrumbItem("Rock", "Rock"), BreadcrumbItem("Rock/$name", name)),
    )

    private fun file(id: String) = DirectoryChildPaged(id = id, isDir = false, title = "Song $id")

    @Test
    fun `activate loads libraries once and the filter narrows them by name`() {
        val api = FakeFilesApi()
        val viewModel = viewModel(api)

        viewModel.activate()
        viewModel.activate()
        viewModel.setFilter("pod")

        assertEquals(1, api.librariesCalls)
        assertEquals(listOf("Podcasts"), viewModel.uiState.value.visibleLibraries.map { it.name })
    }

    @Test
    fun `navigating up walks the folder path back to the library list`() {
        val viewModel = viewModel()

        viewModel.openLibrary(1)
        viewModel.openFolder("Rock/Album")
        assertEquals(FilesLocation(1, "Rock/Album"), viewModel.uiState.value.location)

        assertTrue(viewModel.navigateUp())
        assertEquals("Rock", viewModel.uiState.value.location?.path)
        assertTrue(viewModel.navigateUp())
        assertEquals("", viewModel.uiState.value.location?.path)
        assertTrue(viewModel.navigateUp())
        assertNull(viewModel.uiState.value.location)
        assertFalse(viewModel.navigateUp())
    }

    @Test
    fun `listing summary keeps the ancestors and ignores a stale folder`() {
        val viewModel = viewModel()
        viewModel.openLibrary(1)
        viewModel.openFolder("Rock/Album")

        viewModel.onListing(FilesLocation(1, "Rock/Album"), listing("Album", folders = 2))
        assertEquals(listOf("Rock"), viewModel.uiState.value.currentSummary?.ancestors?.map { it.name })

        viewModel.openFolder("Rock")
        assertNull(viewModel.uiState.value.currentSummary)
    }

    @Test
    fun `playing a file queues the folder's files from its index among files`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        viewModel.openLibrary(1)
        viewModel.openFolder("Rock/Album")
        viewModel.onListing(FilesLocation(1, "Rock/Album"), listing("Album", folders = 2))
        viewModel.setFilter("live")
        viewModel.selectSort("size")

        viewModel.playFile(file("s2"), position = 3)

        val spec = starter.specs.single()
        assertEquals("directoryFlat", spec.sourceType)
        assertEquals("1:Rock/Album", spec.sourceId)
        assertEquals(1, spec.startIndex)
        assertEquals("s2", spec.startSongId)
        assertEquals(JsonPrimitive("live"), spec.filters["filter"])
        assertEquals(JsonPrimitive("size"), spec.sort?.get("field"))
    }

    @Test
    fun `folder actions use the recursive directory source`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        viewModel.openLibrary(1)
        val folder = DirectoryChildPaged(id = "Jazz", isDir = true, title = "Jazz", path = "Jazz")

        viewModel.playFolder(folder, shuffle = true)
        viewModel.addFolderToQueue(folder, QueueAddPosition.NEXT)

        val spec = starter.specs.single()
        assertEquals("directory", spec.sourceType)
        assertEquals("1:Jazz", spec.sourceId)
        assertTrue(spec.shuffle)
        val (add, position) = starter.queueAdds.single()
        assertEquals(listOf(QueueSourceRequest("directory", "1:Jazz")), add.sources)
        assertEquals(QueueAddPosition.NEXT, position)
    }

    @Test
    fun `adding a folder carries the active filter`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        viewModel.openLibrary(1)
        viewModel.setFilter("live")
        val folder = DirectoryChildPaged(id = "Jazz", isDir = true, title = "Jazz", path = "Jazz")

        viewModel.addFolderToQueue(folder, QueueAddPosition.END)

        val (add, _) = starter.queueAdds.single()
        assertEquals(
            listOf(QueueSourceRequest("directory", "1:Jazz", filters = mapOf("filter" to JsonPrimitive("live")))),
            add.sources,
        )
    }
}
