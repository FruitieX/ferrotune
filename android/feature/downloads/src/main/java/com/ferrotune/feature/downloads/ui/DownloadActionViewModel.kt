package com.ferrotune.feature.downloads.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope

import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.SongDownloadState
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class DownloadActionViewModel @Inject constructor(
    private val repository: DownloadRepository,
) : ViewModel() {

    val states: StateFlow<Map<String, SongDownloadState>> = repository.states
    val downloadedSongIds: StateFlow<Set<String>> = repository.downloadedSongIds
    val downloadedContainerIds: StateFlow<Set<String>> = repository.downloadedContainerIds

    private val _busy = MutableStateFlow<Set<String>>(emptySet())
    val busy: StateFlow<Set<String>> = _busy.asStateFlow()

    fun toggleSong(songId: String) {
        viewModelScope.launch {
            if (songId in downloadedSongIds.value) {
                repository.removeSong(songId)
            } else {
                repository.enqueueSong(songId)
            }
        }
    }

    fun downloadAlbum(albumId: String, name: String, coverArtId: String?) = withBusy(albumId) {
        repository.downloadAlbum(albumId, name, coverArtId)
    }

    fun downloadPlaylist(playlistId: String, name: String, coverArtId: String?) =
        withBusy(playlistId) {
            repository.downloadPlaylist(playlistId, name, coverArtId)
        }

    fun downloadSmartPlaylist(smartPlaylistId: String, name: String, coverArtId: String?) =
        withBusy(smartPlaylistId) {
            repository.downloadSmartPlaylist(smartPlaylistId, name, coverArtId)
        }

    fun removeContainer(containerId: String) = withBusy(containerId) {
        repository.removeContainer(containerId)
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
}
