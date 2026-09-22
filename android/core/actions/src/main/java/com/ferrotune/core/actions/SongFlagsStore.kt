package com.ferrotune.core.actions

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.StarRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Favorite state for one song. */
data class SongFlags(
    val starred: Boolean,
)

/**
 * Partial optimistic change for one song. `null` fields fall through to the
 * server-provided [SongFlags], so a pending change never clobbers fresh data.
 */
data class SongFlagsOverride(
    val starred: Boolean? = null,
) {
    fun mergedWith(base: SongFlags): SongFlags = SongFlags(
        starred = starred ?: base.starred,
    )

    /** True once [base] already reflects every overridden field. */
    fun isSatisfiedBy(base: SongFlags): Boolean = starred == null || starred == base.starred
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
