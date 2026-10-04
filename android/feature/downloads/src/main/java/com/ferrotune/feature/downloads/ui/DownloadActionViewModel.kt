package com.ferrotune.feature.downloads.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.SongDownloadState
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Download actions shared by song rows, selections, and album/playlist menus.
 * Every action confirms or explains its outcome through [UserMessages].
 */
@HiltViewModel
class DownloadActionViewModel @Inject constructor(
    private val repository: DownloadRepository,
    private val messages: UserMessages,
) : ViewModel() {

    val states: StateFlow<Map<String, SongDownloadState>> = repository.states
    val downloadedSongIds: StateFlow<Set<String>> = repository.downloadedSongIds
    val downloadedContainerIds: StateFlow<Set<String>> = repository.downloadedContainerIds

    private val _busy = MutableStateFlow<Set<String>>(emptySet())
    val busy: StateFlow<Set<String>> = _busy.asStateFlow()

    fun toggleSong(songId: String) {
        viewModelScope.launch {
            if (songId in downloadedSongIds.value) {
                runCatching { repository.removeSong(songId) }
                    .onSuccess { messages.show("Removed download") }
                    .onFailure { messages.failure("Couldn't remove the download", it) }
            } else {
                runCatching { repository.enqueueSong(songId) }
                    .onSuccess { messages.show("Downloading song") }
                    .onFailure { messages.failure(START_FAILURE, it) }
            }
        }
    }

    /** Enqueues every not-yet-downloaded song in a bulk selection. */
    fun downloadSongs(songIds: List<String>) {
        viewModelScope.launch {
            val downloaded = downloadedSongIds.value
            val pending = songIds.filterNot { it in downloaded }
            if (pending.isEmpty()) {
                messages.show("Already downloaded")
                return@launch
            }
            runCatching { pending.forEach { repository.enqueueSong(it) } }
                .onSuccess { messages.show("Downloading ${songCount(pending.size)}") }
                .onFailure { messages.failure(START_FAILURE, it) }
        }
    }

    fun downloadAlbum(albumId: String, name: String, coverArtId: String?) =
        downloadContainer(albumId, name) { repository.downloadAlbum(albumId, name, coverArtId) }

    fun downloadPlaylist(playlistId: String, name: String, coverArtId: String?) =
        downloadContainer(playlistId, name) {
            repository.downloadPlaylist(playlistId, name, coverArtId)
        }

    fun downloadSmartPlaylist(smartPlaylistId: String, name: String, coverArtId: String?) =
        downloadContainer(smartPlaylistId, name) {
            repository.downloadSmartPlaylist(smartPlaylistId, name, coverArtId)
        }

    fun removeContainer(containerId: String) = withBusy(containerId) {
        runCatching { repository.removeContainer(containerId) }
            .onSuccess { messages.show("Removed download") }
            .onFailure { messages.failure("Couldn't remove the download", it) }
    }

    private fun downloadContainer(key: String, name: String, block: suspend () -> Int) = withBusy(key) {
        runCatching { block() }
            .onSuccess { count ->
                messages.show(
                    if (count == 0) "Nothing to download in $name" else "Downloading ${songCount(count)} from $name",
                )
            }
            .onFailure { messages.failure(START_FAILURE, it) }
    }

    private fun withBusy(key: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = _busy.value + key
            try {
                block()
            } finally {
                _busy.value = _busy.value - key
            }
        }
    }

    private fun songCount(count: Int) = if (count == 1) "1 song" else "$count songs"

    private companion object {
        const val START_FAILURE = "Couldn't start the download"
    }
}
