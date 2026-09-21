package com.ferrotune.core.database

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.ferrotune.core.network.generated.SongResponse

@Entity(tableName = "downloaded_songs")
data class DownloadedSongEntity(
    @PrimaryKey val songId: String,
    val title: String,
    val artist: String,
    val artistId: String,
    val album: String?,
    val albumId: String?,
    val duration: Long,
    val track: Int?,
    val coverArtId: String?,
    val coverArtData: String?,
    val fileFormat: String?,
    val downloadedAt: Long,
)

@Entity(tableName = "downloaded_containers")
data class DownloadedContainerEntity(
    @PrimaryKey val containerId: String,
    val type: String,
    val name: String,
    val coverArtId: String?,
    val downloadedAt: Long,
)

@Entity(
    tableName = "downloaded_container_songs",
    primaryKeys = ["containerId", "songId"],
    foreignKeys = [
        ForeignKey(
            entity = DownloadedContainerEntity::class,
            parentColumns = ["containerId"],
            childColumns = ["containerId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("songId")],
)
data class DownloadedContainerSongEntity(
    val containerId: String,
    val songId: String,
    val position: Int,
)

data class ContainerWithCount(
    @Embedded val container: DownloadedContainerEntity,
    val songCount: Int,
)

object DownloadContainerType {
    const val ALBUM = "album"
    const val PLAYLIST = "playlist"
    const val SMART_PLAYLIST = "smartPlaylist"
    const val ARTIST = "artist"

    fun id(type: String, sourceId: String): String = "$type:$sourceId"
}

fun SongResponse.toDownloadedSong(
    downloadedAt: Long = System.currentTimeMillis(),
): DownloadedSongEntity = DownloadedSongEntity(
    songId = id,
    title = title,
    artist = artist,
    artistId = artistId,
    album = album,
    albumId = albumId,
    duration = duration,
    track = track,
    coverArtId = coverArt,
    coverArtData = coverArtData,
    fileFormat = suffix.ifBlank { null },
    downloadedAt = downloadedAt,
)
