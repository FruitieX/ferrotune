package com.ferrotune.feature.downloads.ui

import com.ferrotune.core.actions.UserMessage
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.network.FerrotuneApi
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.testServerPreferences
import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.DownloadSettingsRepository
import com.ferrotune.feature.downloads.data.FakeDownloadApi
import com.ferrotune.feature.downloads.data.FakeDownloadDao
import com.ferrotune.feature.downloads.data.FakeDownloadEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
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
        api: FerrotuneApi = FakeDownloadApi(),
    ): DownloadRepository {
        val provider = FakeApiProvider(api)
        return DownloadRepository(engine, dao, provider, DownloadSettingsRepository(testServerPreferences(provider.api), engine))
    }

    @Test
    fun `play materializes the downloaded library as an offline queue`() = runTest {
        val repository = repository()
        repository.downloadAlbum("album-1", "Album", null)
        val starter = FakePlaybackStarter()
        val viewModel = DownloadsViewModel(repository, starter, UserMessages())

        viewModel.play("album-1-2")

        val queue = starter.offlineQueues.single()
        assertEquals(listOf("album-1-1", "album-1-2"), queue.window.songs.map { it.song.id })
        assertEquals(1, queue.currentIndex)
    }

    @Test
    fun `saved albums play in their saved order with their source`() = runTest {
        val repository = repository()
        repository.downloadAlbum("album-1", "Album", null)
        val starter = FakePlaybackStarter()
        val viewModel = DownloadsViewModel(repository, starter, UserMessages())
        val container = repository.containers.first().single()

        viewModel.playContainer(container)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (starter.offlineQueues.isEmpty()) yield() }
        }

        val queue = starter.offlineQueues.single()
        assertEquals("album", queue.sourceType)
        assertEquals("album-1", queue.sourceId)
        assertEquals(listOf("album-1-1", "album-1-2"), queue.window.songs.map { it.song.id })
        assertEquals(0, queue.currentIndex)
    }

    @Test
    fun `playback failures become messages`() = runTest {
        val repository = repository()
        repository.downloadAlbum("album-1", "Album", null)
        val starter = FakePlaybackStarter(failure = "Not signed in")
        val messages = UserMessages()
        val received = recordMessages(messages)
        val viewModel = DownloadsViewModel(repository, starter, messages)

        viewModel.play("album-1-1")
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (received.isEmpty()) yield() }
        }

        assertTrue(received.single().isError)
        assertTrue(received.single().text.startsWith("Couldn't play downloads"))
    }

    @Test
    fun `removeSong cancels the download`() = runTest {
        val engine = FakeDownloadEngine()
        val repository = repository(engine)
        repository.downloadAlbum("album-1", "Album", null)
        val viewModel = DownloadsViewModel(repository, FakePlaybackStarter(), UserMessages())

        viewModel.removeSong(repository.downloadedSongs.first().first { it.songId == "album-1-1" })
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (engine.cancelled.isEmpty()) yield() }
        }

        assertEquals(listOf("album-1-1"), engine.cancelled)
    }

    @Test
    fun `container action toggles album downloads`() = runTest {
        val engine = FakeDownloadEngine()
        val dao = FakeDownloadDao()
        val repository = repository(engine, dao)
        val messages = UserMessages()
        val received = recordMessages(messages)
        val viewModel = DownloadActionViewModel(repository, messages)

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
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (received.size < 2) yield() }
        }
        assertEquals(listOf("Downloading 2 songs from Album", "Removed download"), received.map { it.text })
    }

    @Test
    fun `failed downloads explain themselves instead of crashing`() = runTest {
        val engine = FakeDownloadEngine()
        val repository = repository(engine, api = object : FakeFerrotuneApi() {})
        val messages = UserMessages()
        val received = recordMessages(messages)
        val viewModel = DownloadActionViewModel(repository, messages)

        viewModel.downloadAlbum("album-1", "Album", null)
        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (received.isEmpty()) yield() }
        }

        assertTrue(received.single().isError)
        assertTrue(received.single().text.startsWith("Couldn't start the download"))
        assertTrue(engine.enqueued.isEmpty())
    }

    private fun recordMessages(messages: UserMessages): List<UserMessage> {
        val received = java.util.Collections.synchronizedList(mutableListOf<UserMessage>())
        CoroutineScope(UnconfinedTestDispatcher()).launch { messages.messages.collect { received += it } }
        return received
    }
}
