package com.ferrotune.core.actions

import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongIdsResponse
import com.ferrotune.core.network.generated.SourceSongIdsResponse
import com.ferrotune.core.network.generated.SourceSongsRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SongActionsViewModelTest {

    private lateinit var mainDispatcher: TestDispatcher

    private class RecordingApi : FakeFerrotuneApi() {
        val starRequests = mutableListOf<StarRequest>()
        val sourceRequests = mutableListOf<SourceSongsRequest>()
        val idParams = mutableListOf<Map<String, String>>()
        var sourceIds: List<String> = emptyList()
        var searchIds: List<String> = emptyList()

        override suspend fun star(request: StarRequest) {
            starRequests += request
        }

        override suspend fun sourceSongIds(request: SourceSongsRequest): SourceSongIdsResponse {
            sourceRequests += request
            return SourceSongIdsResponse(ids = sourceIds, total = sourceIds.size.toLong())
        }

        override suspend fun songIds(params: Map<String, String>): SongIdsResponse {
            idParams += params
            return SongIdsResponse(ids = searchIds, total = searchIds.size.toLong())
        }
    }

    @Before
    fun setUp() {
        mainDispatcher = UnconfinedTestDispatcher()
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: RecordingApi,
        playback: FakePlaybackStarter = FakePlaybackStarter(),
    ): Pair<SongActionsViewModel, FakePlaybackStarter> {
        val store = SongFlagsStore(FakeApiProvider(api))
        return SongActionsViewModel(store, playback, FakeApiProvider(api)) to playback
    }

    @Test
    fun `bulk star sends every selected id in one request`() = runTest {
        val api = RecordingApi()
        val (vm, _) = viewModel(api)

        vm.setStarredBulk(listOf("song-1", "song-2"), starred = true)
        mainDispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf(listOf("song-1", "song-2")), api.starRequests.map { it.id })
    }

    @Test
    fun `select all resolves ids from a collection source`() = runTest {
        val api = RecordingApi().apply { sourceIds = listOf("song-1", "song-2", "song-3") }
        val (vm, _) = viewModel(api)
        var loaded: List<String>? = null

        vm.loadAllIds(
            sources = listOf(QueueSourceRequest(sourceType = "album", sourceId = "album-1")),
            onLoaded = { loaded = it },
        )
        mainDispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf("song-1", "song-2", "song-3"), loaded)
        assertEquals("album", api.sourceRequests.single().sources.single().sourceType)
        assertEquals("album-1", api.sourceRequests.single().sources.single().sourceId)
    }

    @Test
    fun `select all resolves ids from search params`() = runTest {
        val api = RecordingApi().apply { searchIds = listOf("song-9") }
        val (vm, _) = viewModel(api)
        var loaded: List<String>? = null

        vm.loadAllIds(
            searchParams = SearchParams(
                query = "*",
                songSort = "name",
                songSortDir = "asc",
            ),
            onLoaded = { loaded = it },
        )
        mainDispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf("song-9"), loaded)
        val params = api.idParams.single()
        assertEquals("*", params["query"])
        assertEquals("name", params["songSort"])
        assertEquals("asc", params["songSortDir"])
    }

    @Test
    fun `play next queues the selection at the next position`() = runTest {
        val api = RecordingApi()
        val (vm, playback) = viewModel(api)

        vm.playNext(listOf("song-1"))
        mainDispatcher.scheduler.advanceUntilIdle()

        assertEquals(
            listOf("song-1"),
            playback.queueAdds.single().first.songIds,
        )
        assertEquals(QueueAddPosition.NEXT, playback.queueAdds.single().second)
    }

    @Test
    fun `add to queue appends the selection`() = runTest {
        val api = RecordingApi()
        val (vm, playback) = viewModel(api)

        vm.addToQueue(listOf("song-1", "song-2"))
        mainDispatcher.scheduler.advanceUntilIdle()

        assertEquals(
            listOf("song-1", "song-2"),
            playback.queueAdds.single().first.songIds,
        )
        assertEquals(QueueAddPosition.END, playback.queueAdds.single().second)
    }
}
