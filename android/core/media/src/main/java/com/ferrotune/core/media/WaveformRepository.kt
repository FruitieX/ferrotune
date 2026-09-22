package com.ferrotune.core.media

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Loads pre-computed waveform heights for songs and keeps a small in-memory
 * cache so player surfaces do not refetch on every recomposition.
 */
@Singleton
class WaveformRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    private val mutex = Mutex()

    private val cache = object : LinkedHashMap<String, List<Float>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<Float>>): Boolean =
            size > MAX_ENTRIES
    }

    /** Normalized heights (0.15..1.0), or an empty list when unavailable. */
    suspend fun heights(songId: String): List<Float> = mutex.withLock {
        cache[songId]?.let { return it }
        val heights = runCatching {
            apiCall { apiProvider.requireApi().waveform(songId) }
                .heights
                .map { it.toFloat() }
        }.getOrDefault(emptyList())
        if (heights.isNotEmpty()) {
            cache[songId] = heights
        }
        heights
    }

    companion object {
        const val MAX_ENTRIES = 24
    }
}
