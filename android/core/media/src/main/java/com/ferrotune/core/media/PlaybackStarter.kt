package com.ferrotune.core.media

import kotlinx.coroutines.flow.StateFlow

/**
 * Playback start surface used by UI features. Implemented by
 * [PlaybackSessionStarter]; extracted so ViewModels can be unit tested with a
 * fake.
 */
interface PlaybackStarter {
    suspend fun startQueue(spec: QueueStartSpec)

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

    val state: StateFlow<PlaybackState>
}
