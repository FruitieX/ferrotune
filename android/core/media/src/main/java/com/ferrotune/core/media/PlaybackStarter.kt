package com.ferrotune.core.media

import com.ferrotune.core.network.generated.QueueSourceRequest
import kotlinx.coroutines.flow.StateFlow

/** Where newly added queue entries land relative to the current track. */
enum class QueueAddPosition {
    NEXT,
    END,
}

/**
 * Songs to append to the active queue, either as explicit ids or as collection
 * descriptors the server materializes.
 */
data class QueueAddSpec(
    val songIds: List<String> = emptyList(),
    val sources: List<QueueSourceRequest> = emptyList(),
)

/**
 * Playback start surface used by UI features. Implemented by
 * [PlaybackSessionStarter]; extracted so ViewModels can be unit tested with a
 * fake.
 */
interface PlaybackStarter {
    suspend fun startQueue(spec: QueueStartSpec)

    suspend fun addToQueue(spec: QueueAddSpec, position: QueueAddPosition)

    suspend fun startRandomQueue(size: Int = 50)

    suspend fun startSongRadio(
        seedSongId: String,
        sourceName: String? = null,
        startSongId: String? = null,
    )

    suspend fun startAlbum(
        albumId: String,
        sourceName: String? = null,
        startSongId: String? = null,
    )


    suspend fun startArtist(
        artistId: String,
        sourceName: String? = null,
        startSongId: String? = null,
    )

    suspend fun playAtIndex(index: Int)

    suspend fun startOfflineQueue(
        response: GetQueueResponse,
        playWhenReady: Boolean = true,
    )

    val state: StateFlow<PlaybackState>
}
