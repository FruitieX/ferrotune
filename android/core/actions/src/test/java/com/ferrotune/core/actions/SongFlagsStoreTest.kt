package com.ferrotune.core.actions

import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SongFlagsStoreTest {

    private class RecordingApi(
        var failStar: Boolean = false,
    ) : FakeFerrotuneApi() {
        val starred = mutableListOf<List<String>>()
        val unstarred = mutableListOf<List<String>>()

        override suspend fun star(request: StarRequest) {
            if (failStar) throw IllegalStateException("star failed")
            starred += request.id
        }

        override suspend fun unstar(request: StarRequest) {
            if (failStar) throw IllegalStateException("star failed")
            unstarred += request.id
        }
    }

    private fun store(api: RecordingApi): SongFlagsStore =
        SongFlagsStore(FakeApiProvider(api))

    private fun SongFlagsStore.flags(songId: String, base: SongFlags): SongFlags =
        overrideFor(songId)?.mergedWith(base) ?: base

    @Test
    fun `favoriting applies optimistically and calls the api`() = runTest {
        val api = RecordingApi()
        val store = store(api)
        val base = SongFlags(starred = false)

        store.setStarred("song-1", starred = true, base = base)

        assertEquals(SongFlags(starred = true), store.flags("song-1", base))
        assertEquals(listOf(listOf("song-1")), api.starred)
    }

    @Test
    fun `unfavoriting calls unstar`() = runTest {
        val api = RecordingApi()
        val store = store(api)
        val base = SongFlags(starred = true)

        store.setStarred("song-1", starred = false, base = base)

        assertEquals(SongFlags(starred = false), store.flags("song-1", base))
        assertEquals(listOf(listOf("song-1")), api.unstarred)
    }

    @Test
    fun `failed favorite rolls back the optimistic value`() = runTest {
        val api = RecordingApi(failStar = true)
        val store = store(api)
        val base = SongFlags(starred = false)

        val result = runCatching { store.setStarred("song-1", starred = true, base = base) }

        assertEquals(true, result.isFailure)
        assertNull(store.overrideFor("song-1"))
        assertEquals(base, store.flags("song-1", base))
    }

    @Test
    fun `bulk favorite sends one request`() = runTest {
        val api = RecordingApi()
        val store = store(api)

        store.setStarredBulk(listOf("song-1", "song-2"), starred = true)

        assertEquals(listOf(listOf("song-1", "song-2")), api.starred)
        assertEquals(
            SongFlags(starred = true),
            store.flags("song-1", SongFlags(starred = false)),
        )
    }

    @Test
    fun `failed bulk favorite reverts every song`() = runTest {
        val api = RecordingApi(failStar = true)
        val store = store(api)

        val result = runCatching {
            store.setStarredBulk(listOf("song-1", "song-2"), starred = true)
        }

        assertEquals(true, result.isFailure)
        assertNull(store.overrideFor("song-1"))
        assertNull(store.overrideFor("song-2"))
    }

    @Test
    fun `clear drops the override`() = runTest {
        val api = RecordingApi()
        val store = store(api)

        store.setStarred("song-1", starred = true, base = SongFlags(false))
        store.clear("song-1")

        assertNull(store.overrideFor("song-1"))
    }
}
