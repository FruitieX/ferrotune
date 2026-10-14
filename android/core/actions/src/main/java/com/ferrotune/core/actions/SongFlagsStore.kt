package com.ferrotune.core.actions

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.RatingRequest
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.SongLikeResponse
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Favorite, rating and like state for one song (`rating` 0 = unrated). */
data class SongFlags(
    val starred: Boolean,
    val rating: Int = 0,
    val likes: SongLikes = SongLikes(count = 0, lastLikedAtMs = null),
) {
    /** Whether the next like tap undoes the newest like ([LIKE_UNDO_WINDOW_MS]). */
    fun isRecentlyLiked(nowMs: Long = System.currentTimeMillis()): Boolean =
        likes.lastLikedAtMs != null && nowMs - likes.lastLikedAtMs < LIKE_UNDO_WINDOW_MS
}

/**
 * Partial optimistic change for one song. `null` fields fall through to the
 * server-provided [SongFlags], so a pending change never clobbers fresh data.
 */
data class SongFlagsOverride(
    val starred: Boolean? = null,
    val rating: Int? = null,
    val likes: SongLikes? = null,
) {
    fun mergedWith(base: SongFlags): SongFlags = SongFlags(
        starred = starred ?: base.starred,
        rating = rating ?: base.rating,
        likes = likes ?: base.likes,
    )

    /** True once [base] already reflects every overridden field. */
    fun isSatisfiedBy(base: SongFlags): Boolean =
        (starred == null || starred == base.starred) &&
            (rating == null || rating == base.rating) &&
            (likes == null || likes == base.likes)
}

/**
 * App-scoped optimistic overlay for song favorite state. Server responses
 * carry the authoritative values; this store lets every screen show an
 * immediate result and rolls back if the mutation fails.
 */
@Singleton
class SongFlagsStore @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    private val _overrides = MutableStateFlow<Map<String, SongFlagsOverride>>(emptyMap())
    val overrides: StateFlow<Map<String, SongFlagsOverride>> = _overrides.asStateFlow()

    /** Optimistic change for [songId], or null when the server value should win. */
    fun overrideFor(songId: String): SongFlagsOverride? = _overrides.value[songId]

    suspend fun setStarred(songId: String, starred: Boolean, base: SongFlags) {
        val previous = _overrides.value
        update(songId, (previous[songId] ?: SongFlagsOverride()).copy(starred = starred))
        try {
            starRequest(starred, listOf(songId))
        } catch (e: Exception) {
            restore(previous, listOf(songId))
            throw e
        }
    }

    /** Sets a 0-5 star rating (0 clears it); reverts on failure. */
    suspend fun setRating(songId: String, rating: Int) {
        val previous = _overrides.value
        update(songId, (previous[songId] ?: SongFlagsOverride()).copy(rating = rating))
        try {
            apiCall { apiProvider.requireApi().setRating(RatingRequest(id = songId, rating = rating)) }
        } catch (e: Exception) {
            restore(previous, listOf(songId))
            throw e
        }
    }

    /**
     * Likes the song again, or undoes its newest like within the undo window.
     * Shows the expected result at once, then the server's (a like also
     * favorites the song); reverts on failure.
     */
    suspend fun toggleLike(
        songId: String,
        base: SongFlags,
        nowMs: Long = System.currentTimeMillis(),
    ): SongLikeResponse {
        val previous = _overrides.value
        val current = (previous[songId] ?: SongFlagsOverride()).mergedWith(base)
        val undo = current.isRecentlyLiked(nowMs)
        val expected = if (undo) {
            SongLikes(count = (current.likes.count - 1).coerceAtLeast(0), lastLikedAtMs = null)
        } else {
            SongLikes(count = current.likes.count + 1, lastLikedAtMs = nowMs)
        }
        update(
            songId,
            (previous[songId] ?: SongFlagsOverride()).copy(
                likes = expected,
                starred = if (undo) null else true,
            ),
        )
        val result = try {
            apiCall { apiProvider.requireApi().toggleSongLike(songId) }
        } catch (e: Exception) {
            restore(previous, listOf(songId))
            throw e
        }
        update(
            songId,
            (_overrides.value[songId] ?: SongFlagsOverride()).copy(
                likes = SongLikes(
                    count = result.likeCount.toInt(),
                    lastLikedAtMs = parseLikedAt(result.lastLiked),
                ),
                starred = result.starred != null,
            ),
        )
        return result
    }

    /** Favorites/unfavorites many songs in one request; reverts all on failure. */
    suspend fun setStarredBulk(songIds: List<String>, starred: Boolean) {
        if (songIds.isEmpty()) return
        val previous = _overrides.value
        val updated = previous.toMutableMap()
        for (songId in songIds) {
            updated[songId] = (previous[songId] ?: SongFlagsOverride()).copy(starred = starred)
        }
        _overrides.value = updated
        try {
            starRequest(starred, songIds)
        } catch (e: Exception) {
            restore(previous, songIds)
            throw e
        }
    }

    /** Drops the optimistic overlay for [songId] once fresh server data arrives. */
    fun clear(songId: String) {
        _overrides.value = _overrides.value - songId
    }

    fun clearAll() {
        _overrides.value = emptyMap()
    }

    private suspend fun starRequest(starred: Boolean, songIds: List<String>) {
        apiCall {
            val request = StarRequest(id = songIds)
            if (starred) {
                apiProvider.requireApi().star(request)
            } else {
                apiProvider.requireApi().unstar(request)
            }
        }
    }

    private fun update(songId: String, override: SongFlagsOverride) {
        _overrides.value = _overrides.value + (songId to override)
    }

    private fun restore(previous: Map<String, SongFlagsOverride>, songIds: List<String>) {
        val reverted = _overrides.value.toMutableMap()
        for (songId in songIds) {
            val before = previous[songId]
            if (before == null) reverted.remove(songId) else reverted[songId] = before
        }
        _overrides.value = reverted
    }
}
