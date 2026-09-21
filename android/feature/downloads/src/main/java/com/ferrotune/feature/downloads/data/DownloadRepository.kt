package com.ferrotune.feature.downloads.data

import com.ferrotune.core.database.DownloadedContainerSongEntity
import com.ferrotune.core.database.DownloadContainerType
import com.ferrotune.core.database.DownloadDao
import com.ferrotune.core.database.ContainerWithCount
import com.ferrotune.core.database.DownloadedContainerEntity
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.database.toDownloadedSong
import com.ferrotune.core.media.DownloadEngine
import com.ferrotune.core.media.DownloadInfo
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.SongResponse
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SongDownloadState(
    val status: String,
    val percent: Float,
    val bytesDownloaded: Long,
    val bytesTotal: Long,
    val failureReason: String?,
) {
    val isDownloaded: Boolean get() = status == DownloadStatus.COMPLETED
    val isActive: Boolean
        get() = status == DownloadStatus.QUEUED ||
            status == DownloadStatus.DOWNLOADING ||
            status == DownloadStatus.PAUSED
}

object DownloadStatus {
    const val QUEUED = "queued"
    const val DOWNLOADING = "downloading"
    const val COMPLETED = "completed"
    const val FAILED = "failed"
    const val REMOVING = "removing"
    const val PAUSED = "paused"
}

/**
 * Offline download state and metadata. Media3's DownloadManager is the source
 * of truth for byte-level state; Room keeps the song/container metadata the
 * offline UI and queue materializer need after relaunch.
 */
@Singleton
class DownloadRepository @Inject constructor(
    private val engine: DownloadEngine,
    private val dao: DownloadDao,
    private val apiProvider: FerrotuneApiProvider,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _states = MutableStateFlow<Map<String, SongDownloadState>>(emptyMap())
    val states: StateFlow<Map<String, SongDownloadState>> = _states.asStateFlow()

    val downloadedSongs: Flow<List<DownloadedSongEntity>> = dao.songs()
    val containers: Flow<List<DownloadedContainerEntity>> = dao.containers()
    val containersWithCount: Flow<List<ContainerWithCount>> = dao.containersWithCount()

    val downloadedSongIds: StateFlow<Set<String>> = dao.songs()
        .map { songs -> songs.mapTo(mutableSetOf()) { it.songId } }
        .stateIn(scope, SharingStarted.Eagerly, emptySet())

    val downloadedContainerIds: StateFlow<Set<String>> = dao.containers()
        .map { containers -> containers.mapTo(mutableSetOf()) { it.containerId } }
        .stateIn(scope, SharingStarted.Eagerly, emptySet())

    init {
        engine.initialize()
        _states.value = engine.snapshot()
            .filter { it.kind == "audio" }
            .associate { it.songId to it.toSongState() }
        scope.launch {
            engine.events.collect { payload ->
                _states.update { current ->
                    val next = current.toMutableMap()
                    payload.downloads
                        .filter { it.kind == "audio" }
                        .forEach { info ->
                            if (info.status == DownloadStatus.REMOVING) {
                                next.remove(info.songId)
                            } else {
                                next[info.songId] = info.toSongState()
                            }
                        }
                    next
                }
            }
        }
    }

    suspend fun enqueueSong(
        songId: String,
        format: String = DEFAULT_FORMAT,
        maxBitRate: Int? = DEFAULT_MAX_BIT_RATE,
    ) {
        val song = apiProvider.requireApi().song(songId).song
        engine.enqueue(song.id, format, maxBitRate)
        dao.upsertSong(song.toDownloadedSong())
    }

    suspend fun downloadAlbum(albumId: String, name: String, coverArtId: String?) {
        enqueueContainer(
            type = DownloadContainerType.ALBUM,
            sourceId = albumId,
            name = name,
            coverArtId = coverArtId,
            songs = fetchAlbumSongs(albumId),
        )
    }

    suspend fun downloadPlaylist(playlistId: String, name: String, coverArtId: String?) {
        enqueueContainer(
            type = DownloadContainerType.PLAYLIST,
            sourceId = playlistId,
            name = name,
            coverArtId = coverArtId,
            songs = fetchPlaylistSongs(playlistId),
        )
    }

    suspend fun downloadSmartPlaylist(
        smartPlaylistId: String,
        name: String,
        coverArtId: String?,
    ) {
        enqueueContainer(
            type = DownloadContainerType.SMART_PLAYLIST,
            sourceId = smartPlaylistId,
            name = name,
            coverArtId = coverArtId,
            songs = fetchSmartPlaylistSongs(smartPlaylistId),
        )
    }

    private suspend fun enqueueContainer(
        type: String,
        sourceId: String,
        name: String,
        coverArtId: String?,
        songs: List<SongResponse>,
    ) {
        if (songs.isEmpty()) return
        val containerId = DownloadContainerType.id(type, sourceId)
        val now = System.currentTimeMillis()
        songs.forEach { engine.enqueue(it.id, DEFAULT_FORMAT, DEFAULT_MAX_BIT_RATE) }
        dao.upsertContainer(
            DownloadedContainerEntity(
                containerId = containerId,
                type = type,
                name = name,
                coverArtId = coverArtId,
                downloadedAt = now,
            ),
        )
        dao.upsertSongs(songs.map { it.toDownloadedSong(now) })
        dao.clearContainerSongs(containerId)
        dao.upsertContainerSongs(
            songs.mapIndexed { index, song ->
                DownloadedContainerSongEntity(containerId, song.id, index)
            },
        )
    }

    suspend fun removeSong(songId: String) {
        engine.cancel(songId)
        dao.deleteSong(songId)
        dao.removeSongFromContainers(songId)
        dao.pruneEmptyContainers()
    }

    suspend fun removeContainer(containerId: String) {
        val songIds = dao.containerSongIds(containerId)
        dao.deleteContainer(containerId)
        songIds.forEach { songId ->
            if (dao.containerMembershipCount(songId) == 0) {
                engine.cancel(songId)
                dao.deleteSong(songId)
            }
        }
    }

    suspend fun clearAll() {
        engine.removeAll()
        dao.clearAllSongs()
        dao.clearAllContainers()
    }

    fun pauseAll() = engine.pauseAll()

    fun resumeAll() = engine.resumeAll()

    fun setWifiOnly(wifiOnly: Boolean) = engine.setWifiOnly(wifiOnly)

    private suspend fun fetchAlbumSongs(albumId: String): List<SongResponse> {
        val songs = mutableListOf<SongResponse>()
        var offset = 0
        while (songs.size < MAX_CONTAINER_SONGS) {
            val page = apiProvider.requireApi().albumSongs(
                albumId,
                mapOf("offset" to offset.toString(), "count" to PAGE_SIZE.toString()),
            )
            songs += page.songs
            offset += page.songs.size
            if (page.songs.isEmpty() || songs.size >= page.total) break
        }
        return songs
    }

    private suspend fun fetchPlaylistSongs(playlistId: String): List<SongResponse> {
        val songs = mutableListOf<SongResponse>()
        var offset = 0
        while (songs.size < MAX_CONTAINER_SONGS) {
            val page = apiProvider.requireApi().playlistSongs(
                playlistId,
                mapOf("offset" to offset.toString(), "count" to PAGE_SIZE.toString()),
            )
            val pageSongs = page.entries.mapNotNull { it.song }
            songs += pageSongs
            offset += page.entries.size
            if (page.entries.isEmpty() || offset >= page.totalEntries) break
        }
        return songs
    }

    private suspend fun fetchSmartPlaylistSongs(smartPlaylistId: String): List<SongResponse> {
        val songs = mutableListOf<SongResponse>()
        var offset = 0
        while (songs.size < MAX_CONTAINER_SONGS) {
            val page = apiProvider.requireApi().smartPlaylistSongs(
                smartPlaylistId,
                mapOf("offset" to offset.toString(), "count" to PAGE_SIZE.toString()),
            )
            songs += page.songs
            offset += page.songs.size
            if (page.songs.isEmpty() || songs.size >= page.totalCount) break
        }
        return songs
    }

    private companion object {
        const val DEFAULT_FORMAT = "opus"
        const val DEFAULT_MAX_BIT_RATE = 128
        const val PAGE_SIZE = 200
        const val MAX_CONTAINER_SONGS = 2000
    }
}

private fun DownloadInfo.toSongState(): SongDownloadState = SongDownloadState(
    status = status,
    percent = percent,
    bytesDownloaded = bytesDownloaded,
    bytesTotal = bytesTotal,
    failureReason = failureReason,
)
