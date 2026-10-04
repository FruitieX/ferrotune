package com.ferrotune.feature.downloads.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.database.ContainerWithCount
import com.ferrotune.core.database.DownloadedContainerEntity
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.DownloadStatus
import com.ferrotune.feature.downloads.data.SongDownloadState
import com.ferrotune.feature.downloads.data.materializeOfflineQueue
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DownloadsUiState(
    val songs: List<DownloadedSongEntity> = emptyList(),
    val containers: List<ContainerWithCount> = emptyList(),
    val states: Map<String, SongDownloadState> = emptyMap(),
) {
    val isEmpty: Boolean get() = songs.isEmpty() && containers.isEmpty()

    /** Total length of the downloaded songs, in seconds (like [DownloadedSongEntity.duration]). */
    val totalDurationSeconds: Long get() = songs.sumOf { it.duration }

    /** Songs still queued, downloading, paused, or failed. */
    val pendingCount: Int get() = songs.count { states[it.songId]?.status.isPending() }
}

private fun String?.isPending(): Boolean =
    this == DownloadStatus.QUEUED || this == DownloadStatus.DOWNLOADING ||
        this == DownloadStatus.PAUSED || this == DownloadStatus.FAILED

/**
 * The Downloads page. Everything here plays from local storage, so it works
 * offline; queues are materialized from the download database.
 */
@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val repository: DownloadRepository,
    private val playbackStarter: PlaybackStarter,
    private val messages: UserMessages,
) : ViewModel() {

    val uiState: StateFlow<DownloadsUiState> = combine(
        repository.downloadedSongs,
        repository.containersWithCount,
        repository.states,
    ) { songs, containers, states ->
        DownloadsUiState(songs = songs, containers = containers, states = states)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DownloadsUiState())

    /** Plays every downloaded song, starting at [songId] (or shuffled). */
    fun play(songId: String? = null, shuffle: Boolean = false) {
        launchPlayback {
            val songs = repository.downloadedSongs.first()
            startQueue(if (shuffle) songs.shuffled() else songs, "downloads", null, songId)
        }
    }

    /** Plays a saved album or playlist in its saved order (or shuffled). */
    fun playContainer(container: DownloadedContainerEntity, shuffle: Boolean = false) {
        launchPlayback {
            val songs = repository.containerSongs(container.containerId)
            startQueue(
                if (shuffle) songs.shuffled() else songs,
                container.type,
                container.containerId.substringAfter(':'),
                null,
            )
        }
    }

    fun removeSong(song: DownloadedSongEntity) {
        viewModelScope.launch {
            runCatching { repository.removeSong(song.songId) }
                .onSuccess { messages.show("Removed \"${song.title}\" from downloads") }
                .onFailure { messages.failure("Couldn't remove the download", it) }
        }
    }

    fun removeContainer(container: DownloadedContainerEntity) {
        viewModelScope.launch {
            runCatching { repository.removeContainer(container.containerId) }
                .onSuccess { messages.show("Removed \"${container.name}\" from downloads") }
                .onFailure { messages.failure("Couldn't remove the download", it) }
        }
    }

    fun pauseAll() {
        repository.pauseAll()
        messages.show("Downloads paused")
    }

    fun resumeAll() {
        repository.resumeAll()
        messages.show("Downloads resumed")
    }

    fun clearAll() {
        viewModelScope.launch {
            runCatching { repository.clearAll() }
                .onSuccess { messages.show("Downloads cleared") }
                .onFailure { messages.failure("Couldn't clear downloads", it) }
        }
    }

    private suspend fun startQueue(
        songs: List<DownloadedSongEntity>,
        sourceType: String,
        sourceId: String?,
        startSongId: String?,
    ) {
        if (songs.isEmpty()) return
        playbackStarter.startOfflineQueue(
            materializeOfflineQueue(songs, sourceType, sourceId, startSongId),
            playWhenReady = true,
        )
    }

    private fun launchPlayback(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { messages.failure("Couldn't play downloads", it) }
        }
    }
}
