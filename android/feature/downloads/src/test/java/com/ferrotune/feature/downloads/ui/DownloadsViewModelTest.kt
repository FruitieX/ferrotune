package com.ferrotune.feature.downloads.ui

import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.DownloadSettingsRepository
import com.ferrotune.feature.downloads.data.FakeDownloadApi
import com.ferrotune.feature.downloads.data.FakeDownloadDao
import com.ferrotune.feature.downloads.data.FakeDownloadEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DownloadsViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun repository(
        engine: FakeDownloadEngine = FakeDownloadEngine(),
        dao: FakeDownloadDao = FakeDownloadDao(),
    ): DownloadRepository {
        val provider = FakeApiProvider(FakeDownloadApi())
        return DownloadRepository(engine, dao, provider, DownloadSettingsRepository(provider, engine))
    }

    @Test
    fun `play materializes the downloaded library as an offline queue`() = runTest {
        val repository = repository()
        repository.downloadAlbum("album-1", "Album", null)
        val starter = FakePlaybackStarter()
        val viewModel = DownloadsViewModel(repository, starter)

        viewModel.play("album-1-2")

        val queue = starter.offlineQueues.single()
        assertEquals(listOf("album-1-1", "album-1-2"), queue.window.songs.map { it.song.id })
        assertEquals(1, queue.currentIndex)
    }

    @Test
    fun `removeSong cancels the download`() = runTest {
        val engine = FakeDownloadEngine()
        val repository = repository(engine)
        repository.downloadAlbum("album-1", "Album", null)
        val viewModel = DownloadsViewModel(repository, FakePlaybackStarter())

        viewModel.removeSong("album-1-1")

        assertEquals(listOf("album-1-1"), engine.cancelled)
    }

    @Test
    fun `container action toggles album downloads`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)
        val viewModel = DownloadActionViewModel(repository)

        viewModel.downloadAlbum("album-1", "Album", null)
        val containerId = DownloadContainerType.id(DownloadContainerType.ALBUM, "album-1")
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { repository.downloadedContainerIds.first { containerId in it } }
        }

        viewModel.removeContainer(containerId)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { repository.downloadedContainerIds.first { containerId !in it } }
        }

        assertTrue(engine.cancelled.containsAll(listOf("album-1-1", "album-1-2")))
        assertTrue(dao.songs.value.isEmpty())
    }
}
