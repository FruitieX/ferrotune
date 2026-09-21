package com.ferrotune.core.actions

import com.ferrotune.core.network.dto.RatingRequest
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
        var failRating: Boolean = false,
    ) : FakeFerrotuneApi() {
        val starred = mutableListOf<String>()
        val unstarred = mutableListOf<String>()
        val ratings = mutableListOf<Pair<String, Int>>()

        override suspend fun star(request: StarRequest) {
            if (failStar) throw IllegalStateException("star failed")
            starred += request.id
        }

        override suspend fun unstar(request: StarRequest) {
            if (failStar) throw IllegalStateException("star failed")
            unstarred += request.id
        }

        override suspend fun setRating(request: RatingRequest) {
            if (failRating) throw IllegalStateException("rating failed")
            ratings += request.id to request.rating
        }
    }

    private fun store(api: RecordingApi): SongFlagsStore =
        SongFlagsStore(FakeApiProvider(api))

    @Test
    fun `starring applies optimistically and calls the api`() = runTest {
        val api = RecordingApi()
        val store = store(api)
        val base = SongFlags(starred = false, rating = 0)

        store.setStarred("song-1", starred = true, base = base)

        assertEquals(SongFlags(starred = true, rating = 0), store.flagsFor("song-1"))
        assertEquals(listOf("song-1"), api.starred)
    }

    @Test
    fun `unstarring calls unstar`() = runTest {
        val api = RecordingApi()
        val store = store(api)
        val base = SongFlags(starred = true, rating = 3)

        store.setStarred("song-1", starred = false, base = base)

        assertEquals(SongFlags(starred = false, rating = 3), store.flagsFor("song-1"))
        assertEquals(listOf("song-1"), api.unstarred)
    }

    @Test
    fun `failed star rolls back the optimistic value`() = runTest {
        val api = RecordingApi(failStar = true)
        val store = store(api)
        val base = SongFlags(starred = false, rating = 0)

        val result = runCatching { store.setStarred("song-1", starred = true, base = base) }

        assertEquals(true, result.isFailure)
        assertEquals(base, store.flagsFor("song-1"))
    }

    @Test
    fun `rating is clamped to five stars`() = runTest {
        val api = RecordingApi()
        val store = store(api)

        store.setRating("song-1", rating = 9, base = SongFlags(starred = false, rating = 0))

        assertEquals(5, store.flagsFor("song-1")?.rating)
        assertEquals(listOf("song-1" to 5), api.ratings)
    }

    @Test
    fun `failed rating rolls back`() = runTest {
        val api = RecordingApi(failRating = true)
        val store = store(api)

        val base = SongFlags(starred = false, rating = 1)
        val result = runCatching {
            store.setRating("song-1", rating = 4, base = base)
        }

        assertEquals(true, result.isFailure)
        assertEquals(base, store.flagsFor("song-1"))
    }

    @Test
    fun `clear drops the override`() = runTest {
        val api = RecordingApi()
        val store = store(api)

        store.setStarred("song-1", starred = true, base = SongFlags(false, 0))
        store.clear("song-1")

        assertNull(store.flagsFor("song-1"))
    }
}
