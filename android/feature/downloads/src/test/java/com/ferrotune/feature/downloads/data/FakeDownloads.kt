package com.ferrotune.feature.downloads.data

import com.ferrotune.core.database.ContainerWithCount
import com.ferrotune.core.database.DownloadDao
import com.ferrotune.core.database.DownloadedContainerEntity
import com.ferrotune.core.database.DownloadedContainerSongEntity
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.media.DownloadEngine
import com.ferrotune.core.media.DownloadInfo
import com.ferrotune.core.media.DownloadStateEventPayload
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

internal class FakeDownloadEngine : DownloadEngine {
    override val events = MutableSharedFlow<DownloadStateEventPayload>(extraBufferCapacity = 8)
    var snapshotResult: List<DownloadInfo> = emptyList()
    val enqueued = mutableListOf<Triple<String, String, Int?>>()
    val cancelled = mutableListOf<String>()
    var initialized = false
    var paused = false
    var resumed = false
    var removedAll = false
    var wifiOnly: Boolean? = null

    override fun initialize() {
        initialized = true
    }

    override fun snapshot(): List<DownloadInfo> = snapshotResult

    override fun enqueue(songId: String, format: String, maxBitRate: Int?) {
        enqueued += Triple(songId, format, maxBitRate)
    }

    override fun cancel(songId: String) {
        cancelled += songId
    }

    override fun pauseAll() {
        paused = true
    }

    override fun resumeAll() {
        resumed = true
    }

    override fun removeAll() {
        removedAll = true
    }

    override fun setWifiOnly(wifiOnly: Boolean) {
        this.wifiOnly = wifiOnly
    }
}

internal class FakeDownloadDao : DownloadDao {
    val songs = MutableStateFlow<List<DownloadedSongEntity>>(emptyList())
    val containers = MutableStateFlow<List<DownloadedContainerEntity>>(emptyList())
    val containerSongs = MutableStateFlow<List<DownloadedContainerSongEntity>>(emptyList())

    override suspend fun upsertSong(song: DownloadedSongEntity) {
        songs.value = songs.value.filterNot { it.songId == song.songId } + song
    }

    override suspend fun upsertSongs(songs: List<DownloadedSongEntity>) {
        val incoming = songs.associateBy { it.songId }
        this.songs.value = this.songs.value.filterNot { it.songId in incoming } + songs
    }

    override suspend fun deleteSong(songId: String) {
        songs.value = songs.value.filterNot { it.songId == songId }
    }

    override fun songs(): Flow<List<DownloadedSongEntity>> = songs

    override suspend fun songsOnce(): List<DownloadedSongEntity> = songs.value

    override suspend fun songIds(): List<String> = songs.value.map { it.songId }

    override suspend fun upsertContainer(container: DownloadedContainerEntity) {
        containers.value = containers.value.filterNot {
            it.containerId == container.containerId
        } + container
    }

    override suspend fun upsertContainerSongs(entries: List<DownloadedContainerSongEntity>) {
        containerSongs.value = containerSongs.value + entries
    }

    override suspend fun clearContainerSongs(containerId: String) {
        containerSongs.value = containerSongs.value.filterNot { it.containerId == containerId }
    }

    override suspend fun deleteContainer(containerId: String) {
        containers.value = containers.value.filterNot { it.containerId == containerId }
        containerSongs.value = containerSongs.value.filterNot { it.containerId == containerId }
    }

    override fun containers(): Flow<List<DownloadedContainerEntity>> = containers

    override fun containersWithCount(): Flow<List<ContainerWithCount>> = containers.map { list ->
        list.map { container ->
            ContainerWithCount(
                container = container,
                songCount = containerSongs.value.count { it.containerId == container.containerId },
            )
        }
    }

    override suspend fun containersOnce(): List<DownloadedContainerEntity> = containers.value

    override suspend fun containerSongIds(containerId: String): List<String> = containerSongs.value
        .filter { it.containerId == containerId }
        .sortedBy { it.position }
        .map { it.songId }

    override suspend fun containerMembershipCount(songId: String): Int =
        containerSongs.value.count { it.songId == songId }

    override suspend fun clearAllSongs() {
        songs.value = emptyList()
        containerSongs.value = emptyList()
    }

    override suspend fun clearAllContainers() {
        containers.value = emptyList()
        containerSongs.value = emptyList()
    }

    override suspend fun removeSongFromContainers(songId: String) {
        containerSongs.value = containerSongs.value.filterNot { it.songId == songId }
    }

    override suspend fun pruneEmptyContainers() {
        val used = containerSongs.value.mapTo(mutableSetOf()) { it.containerId }
        containers.value = containers.value.filter { it.containerId in used }
    }
}
