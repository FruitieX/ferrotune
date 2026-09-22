package com.ferrotune.core.testing

import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.GetQueueResponse
import kotlinx.coroutines.flow.MutableStateFlow

data class AlbumStart(
    val albumId: String,
    val sourceName: String?,
    val startSongId: String?,
)

class FakePlaybackStarter(private val failure: String? = null) : PlaybackStarter {
    val specs = mutableListOf<QueueStartSpec>()
    val albumStarts = mutableListOf<AlbumStart>()
    val playedAtIndex = mutableListOf<Int>()
    val offlineQueues = mutableListOf<GetQueueResponse>()
    override val state = MutableStateFlow(PlaybackState())

    override suspend fun startOfflineQueue(response: GetQueueResponse, playWhenReady: Boolean) {
        failure?.let { throw IllegalStateException(it) }
        offlineQueues += response
    }

    override suspend fun playAtIndex(index: Int) {
        failure?.let { throw IllegalStateException(it) }
        playedAtIndex += index
    }

    override suspend fun startQueue(spec: QueueStartSpec) {
        failure?.let { throw IllegalStateException(it) }
        specs += spec
    }

    val queueAdds = mutableListOf<Pair<QueueAddSpec, QueueAddPosition>>()

    override suspend fun addToQueue(spec: QueueAddSpec, position: QueueAddPosition) {
        failure?.let { throw IllegalStateException(it) }
        queueAdds += spec to position
    }

    override suspend fun startRandomQueue(size: Int) = Unit

    override suspend fun startSongRadio(
        seedSongId: String,
        sourceName: String?,
        startSongId: String?,
    ) = Unit

    override suspend fun startAlbum(
        albumId: String,
        sourceName: String?,
        startSongId: String?,
    ) {
        albumStarts += AlbumStart(albumId, sourceName, startSongId)
    }

    override suspend fun startArtist(
        artistId: String,
        sourceName: String?,
        startSongId: String?,
    ) = Unit
}
