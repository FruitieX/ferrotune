package com.ferrotune.core.actions

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.RatingRequest
import com.ferrotune.core.network.dto.StarRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Star + rating state for one song. */
data class SongFlags(
    val starred: Boolean,
    val rating: Int,
)

/**
 * App-scoped optimistic overlay for song star/rating state. Server responses
 * carry the authoritative values; this store lets every screen show an
 * immediate result and rolls back if the mutation fails.
 */
@Singleton
class SongFlagsStore @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    private val _overrides = MutableStateFlow<Map<String, SongFlags>>(emptyMap())
    val overrides: StateFlow<Map<String, SongFlags>> = _overrides.asStateFlow()

    /** Optimistic value for [songId], or null when the server value should win. */
    fun flagsFor(songId: String): SongFlags? = _overrides.value[songId]

    suspend fun setStarred(songId: String, starred: Boolean, base: SongFlags) {
        update(songId, base.copy(starred = starred))
        try {
            apiCall {
                val request = StarRequest(id = listOf(songId))
                if (starred) {
                    apiProvider.requireApi().star(request)
                } else {
                    apiProvider.requireApi().unstar(request)
                }
            }
        } catch (e: Exception) {
            update(songId, base)
            throw e
        }
    }

    suspend fun setRating(songId: String, rating: Int, base: SongFlags) {
        val clamped = rating.coerceIn(0, MAX_RATING)
        update(songId, base.copy(rating = clamped))
        try {
            apiCall {
                apiProvider.requireApi()
                    .setRating(RatingRequest(id = songId, rating = clamped))
            }
        } catch (e: Exception) {
            update(songId, base)
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

    private fun update(songId: String, flags: SongFlags) {
        _overrides.value = _overrides.value + (songId to flags)
    }

    companion object {
        const val MAX_RATING = 5
    }
}
