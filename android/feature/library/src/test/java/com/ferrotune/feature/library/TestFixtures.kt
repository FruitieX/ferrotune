package com.ferrotune.feature.library

import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.SongResponse

internal fun testSong(id: String, title: String = "Song $id"): SongResponse = SongResponse(
    id = id,
    title = title,
    artist = "Artist",
    artistId = "artist-1",
    size = 1024,
    contentType = "audio/flac",
    suffix = "flac",
    duration = 1000,
    path = "Artist/Album/$id.flac",
    created = "2026-01-01T00:00:00.000Z",
    type = "music",
)

internal class FakePlaybackStarter(private val failure: String? = null) : PlaybackStarter {
    val specs = mutableListOf<QueueStartSpec>()
    val albumStarts = mutableListOf<AlbumStart>()

    override suspend fun startQueue(spec: QueueStartSpec) {
        failure?.let { throw IllegalStateException(it) }
        specs += spec
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

internal data class AlbumStart(
    val albumId: String,
    val sourceName: String?,
    val startSongId: String?,
)
