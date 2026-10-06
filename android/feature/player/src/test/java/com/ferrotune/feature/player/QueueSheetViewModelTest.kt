package com.ferrotune.feature.player

import androidx.paging.PagingSource
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.player.data.FakeQueueApi
import com.ferrotune.feature.player.data.QueueEntry
import com.ferrotune.feature.player.data.QueuePagingSource
import com.ferrotune.feature.player.data.QueueRepository
import com.ferrotune.feature.player.data.alignedQueueKey
import com.ferrotune.feature.player.data.testQueueResponse
import com.ferrotune.feature.player.data.testSong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QueueSheetViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun starter(): FakePlaybackStarter = FakePlaybackStarter().apply {
        state.value = PlaybackState(
            sessionId = "session-1",
            queueIndex = 1,
            queueLength = 3,
            status = PlaybackStatus.PLAYING,
            sourceName = "Library",
            sourceType = "library",
        )
    }

    private fun viewModel(
        api: FakeQueueApi = FakeQueueApi(),
        starter: FakePlaybackStarter = starter(),
    ) = QueueSheetViewModel(QueueRepository(FakeApiProvider(api)), starter, UserMessages()).also {
        it.uiState.launchIn(TestScope(UnconfinedTestDispatcher()))
    }

    private fun entry(position: Long) = QueueEntry(
        position = position,
        entryId = "entry-$position",
        song = testSong("song-$position"),
    )

    @Test
    fun `header mirrors the engine's session, index, and source`() {
        val viewModel = viewModel()

        val state = viewModel.uiState.value
        assertEquals("session-1", state.sessionId)
        assertEquals(1, state.currentIndex)
        assertTrue(state.isPlaying)
        assertEquals("Library", state.sourceName)
    }

    @Test
    fun `jump asks the engine to play the queue index`() {
        val starter = starter()
        val viewModel = viewModel(starter = starter)

        viewModel.jumpTo(2)

        assertEquals(listOf(2), starter.playedAtIndex)
    }

    @Test
    fun `remove, clear, and move go through the API for the session`() {
        val api = FakeQueueApi()
        val viewModel = viewModel(api)

        viewModel.remove(entry(1))
        assertEquals(1L, api.removedPosition)
        assertEquals("session-1", api.removeParams?.get("sessionId"))

        viewModel.moveTo(entry(2), 0)
        assertEquals(2L, api.moveRequest?.fromPosition)
        assertEquals(0L, api.moveRequest?.toPosition)

        viewModel.clear()
        assertTrue(api.cleared)
    }

    @Test
    fun `a move makes the player reload its upcoming tracks`() {
        val starter = starter()
        val viewModel = viewModel(starter = starter)
        var pageRefreshes = 0
        TestScope(UnconfinedTestDispatcher()).launch { viewModel.pageRefreshes.collect { pageRefreshes++ } }

        viewModel.moveTo(entry(5), 1)

        assertEquals(1, starter.queueRefreshes)
        // Moves refresh the shown pages in place instead of rebuilding the pager.
        assertEquals(1, pageRefreshes)
    }

    @Test
    fun `moving onto the same position is a no-op`() {
        val api = FakeQueueApi()
        val viewModel = viewModel(api)

        viewModel.moveTo(entry(0), -3)

        assertNull(api.moveRequest)
    }

    @Test
    fun `queue pages are aligned and report placeholders around them`() = runBlocking {
        val api = FakeQueueApi().apply {
            queueHandler = { params ->
                val offset = params["offset"]!!.toInt()
                val limit = params["limit"]!!.toInt()
                testQueueResponse(currentIndex = 0, totalCount = minOf(limit, 130 - offset), offset = offset)
                    .copy(totalCount = 130)
            }
        }
        val source = QueuePagingSource(FakeApiProvider(api), "session-1", pageSize = 50)

        val result = source.load(
            PagingSource.LoadParams.Refresh(key = 73, loadSize = 50, placeholdersEnabled = true),
        ) as PagingSource.LoadResult.Page

        assertEquals("50", api.queueParams?.get("offset"))
        assertEquals(50, result.itemsBefore)
        assertEquals(0, result.prevKey)
        assertEquals(50 + result.data.size, result.nextKey)
        assertEquals(130 - 50 - result.data.size, result.itemsAfter)
    }

    @Test
    fun `aligned keys round down to the page start`() {
        assertEquals(0, alignedQueueKey(-4))
        assertEquals(0, alignedQueueKey(49))
        assertEquals(50, alignedQueueKey(50))
        assertEquals(100, alignedQueueKey(149))
    }
}
