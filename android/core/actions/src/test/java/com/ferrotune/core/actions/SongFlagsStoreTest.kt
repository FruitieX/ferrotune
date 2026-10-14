package com.ferrotune.core.actions

import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.SongLikeResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SongFlagsStoreTest {

    private class RecordingApi(
        var failStar: Boolean = false,
        var likeResponse: SongLikeResponse? = null,
    ) : FakeFerrotuneApi() {
        val starred = mutableListOf<List<String>>()
        val unstarred = mutableListOf<List<String>>()
        val liked = mutableListOf<String>()

        override suspend fun toggleSongLike(songId: String): SongLikeResponse {
            liked += songId
            return likeResponse ?: throw IllegalStateException("like failed")
        }

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

    @Test
    fun `liking shows the server's count and favorites the song`() = runTest {
        val api = RecordingApi(
            likeResponse = SongLikeResponse(
                songId = "song-1",
                liked = true,
                likeCount = 3,
                lastLiked = "2026-10-14T12:00:00.000Z",
                starred = "2026-10-01T08:00:00.000Z",
            ),
        )
        val store = store(api)
        val base = SongFlags(starred = false, likes = SongLikes(count = 2, lastLikedAtMs = 0))

        val result = store.toggleLike("song-1", base, nowMs = LIKE_UNDO_WINDOW_MS * 10)

        assertEquals(true, result.liked)
        assertEquals(listOf("song-1"), api.liked)
        val flags = store.flags("song-1", base)
        assertEquals(SongLikes(count = 3, lastLikedAtMs = parseLikedAt("2026-10-14T12:00:00.000Z")), flags.likes)
        assertEquals(true, flags.starred)
    }

    @Test
    fun `a like within the undo window is recent, an older one is not`() {
        val likedAt = 1_000_000L
        val flags = SongFlags(starred = true, likes = SongLikes(count = 1, lastLikedAtMs = likedAt))

        assertEquals(true, flags.isRecentlyLiked(nowMs = likedAt + LIKE_UNDO_WINDOW_MS - 1))
        assertEquals(false, flags.isRecentlyLiked(nowMs = likedAt + LIKE_UNDO_WINDOW_MS))
        assertEquals(false, SongFlags(starred = true).isRecentlyLiked())
    }

    @Test
    fun `failed like rolls back the optimistic count`() = runTest {
        val api = RecordingApi(likeResponse = null)
        val store = store(api)
        val base = SongFlags(starred = false, likes = SongLikes(count = 1, lastLikedAtMs = null))

        val result = runCatching { store.toggleLike("song-1", base) }

        assertEquals(true, result.isFailure)
        assertNull(store.overrideFor("song-1"))
    }

    @Test
    fun `like labels say whether a tap adds or undoes`() {
        assertEquals("Like", songLikeMenuLabel(0, recentlyLiked = false))
        assertEquals("Like again (2)", songLikeMenuLabel(2, recentlyLiked = false))
        assertEquals("Undo like (3)", songLikeMenuLabel(3, recentlyLiked = true))
        assertEquals(null, parseLikedAt(null))
        assertEquals(0L, parseLikedAt("1970-01-01T00:00:00.000Z"))
    }
}
