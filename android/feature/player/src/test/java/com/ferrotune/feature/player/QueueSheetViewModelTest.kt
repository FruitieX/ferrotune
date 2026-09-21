package com.ferrotune.feature.player

import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.player.data.FakeQueueApi
import com.ferrotune.feature.player.data.QueueRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        state.value = PlaybackState(sessionId = "session-1", queueIndex = 1, queueLength = 3)
    }

    private fun viewModel(
        api: FakeQueueApi = FakeQueueApi(),
        starter: FakePlaybackStarter = starter(),
    ) = QueueSheetViewModel(QueueRepository(FakeApiProvider(api)), starter)

    @Test
    fun `loads the queue for the active playback session`() {
        val api = FakeQueueApi()

        val viewModel = viewModel(api)

        val state = viewModel.uiState.value
        assertFalse(state.loading)
        assertEquals(3, state.totalCount)
        assertEquals(3, state.entries.size)
        assertEquals("Library", state.sourceName)
        assertEquals("session-1", api.queueParams?.get("sessionId"))
    }

    @Test
    fun `without a session the sheet stays empty`() {
        val starter = FakePlaybackStarter()

        val viewModel = viewModel(starter = starter)

        assertFalse(viewModel.uiState.value.loading)
        assertTrue(viewModel.uiState.value.entries.isEmpty())
    }

    @Test
    fun `jump asks the engine to play the queue index`() {
        val starter = starter()
        val viewModel = viewModel(starter = starter)

        viewModel.jumpTo(2)

        assertEquals(listOf(2), starter.playedAtIndex)
    }

    @Test
    fun `mutations go through the API and reload the window`() {
        val api = FakeQueueApi()
        val viewModel = viewModel(api)

        viewModel.remove(1)
        assertEquals(1L, api.removedPosition)

        viewModel.clear()
        assertTrue(api.cleared)

        viewModel.toggleShuffle()
        assertEquals(true, api.shuffleRequest?.enabled)

        viewModel.cycleRepeat()
        assertEquals("all", api.repeatRequest?.mode)
    }

    @Test
    fun `drag move maps slot deltas onto queue positions`() {
        val api = FakeQueueApi()
        val viewModel = viewModel(api)
        val entry = viewModel.uiState.value.entries.first { it.position == 1L }

        viewModel.move(entry, -1)

        assertEquals(1L, api.moveRequest?.fromPosition)
        assertEquals(0L, api.moveRequest?.toPosition)
    }

    @Test
    fun `drag move clamps at the start of the queue`() {
        val api = FakeQueueApi()
        val viewModel = viewModel(api)
        val entry = viewModel.uiState.value.entries.first { it.position == 0L }

        viewModel.move(entry, -3)

        assertEquals(null, api.moveRequest)
    }
}
