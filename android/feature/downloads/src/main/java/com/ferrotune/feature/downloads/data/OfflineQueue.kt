package com.ferrotune.feature.downloads.data

import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.database.DownloadDao
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.media.GetQueueResponse
import com.ferrotune.core.media.OfflineQueueSource
import com.ferrotune.core.media.QueueSong
import com.ferrotune.core.media.QueueWindow
import com.ferrotune.core.media.QueueWindowEntry
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds a queue window from persisted download metadata so playback keeps
 * working when the server is unreachable.
 */
fun materializeOfflineQueue(
    songs: List<DownloadedSongEntity>,
    sourceType: String,
    sourceId: String?,
    startSongId: String?,
): GetQueueResponse {
    val startIndex = startSongId
        ?.let { id -> songs.indexOfFirst { it.songId == id } }
        ?.takeIf { it >= 0 }
        ?: 0
    return GetQueueResponse(
        sourceType = sourceType,
        sourceId = sourceId,
        totalCount = songs.size,
        currentIndex = startIndex,
        positionMs = 0,
        isShuffled = false,
        repeatMode = "off",
        window = QueueWindow(
            offset = 0,
            songs = songs.mapIndexed { index, song ->
                QueueWindowEntry(
                    entryId = "offline:${song.songId}",
                    position = index,
                    song = QueueSong(
                        id = song.songId,
                        title = song.title,
                        artist = song.artist,
                        album = song.album.orEmpty(),
                        coverArt = song.coverArtId,
                        coverArtData = song.coverArtData,
                        duration = (song.duration / 1000).toInt(),
                        computedReplayGainTrackGain = null,
                        originalReplayGainTrackGain = null,
                    ),
                )
            },
        ),
    )
}

@Singleton
class RoomOfflineQueueSource @Inject constructor(
    private val dao: DownloadDao,
) : OfflineQueueSource {
    override suspend fun offlineQueue(
        sourceType: String,
        sourceId: String?,
        startSongId: String?,
    ): GetQueueResponse? {
        val songs = when {
            sourceType == "album" && sourceId != null -> containerSongs(
                DownloadContainerType.ALBUM,
                sourceId,
            )

            sourceType == "playlist" && sourceId != null -> containerSongs(
                DownloadContainerType.PLAYLIST,
                sourceId,
            )

            sourceType == "smartPlaylist" && sourceId != null -> containerSongs(
                DownloadContainerType.SMART_PLAYLIST,
                sourceId,
            )

            else -> dao.songsOnce()
        }
        if (songs.isEmpty()) return null
        return materializeOfflineQueue(songs, sourceType, sourceId, startSongId)
    }

    private suspend fun containerSongs(type: String, sourceId: String): List<DownloadedSongEntity> {
        val containerId = DownloadContainerType.id(type, sourceId)
        val songIds = dao.containerSongIds(containerId)
        if (songIds.isEmpty()) return emptyList()
        val songsById = dao.songsOnce().associateBy { it.songId }
        return songIds.mapNotNull { songsById[it] }
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class OfflineQueueModule {
    @Binds
    abstract fun bindOfflineQueueSource(impl: RoomOfflineQueueSource): OfflineQueueSource
}
