package com.ferrotune.feature.downloads.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.database.ContainerWithCount
import com.ferrotune.core.database.DownloadedSongEntity
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.feature.downloads.data.DownloadRepository
import com.ferrotune.feature.downloads.data.SongDownloadState
import com.ferrotune.feature.downloads.data.materializeOfflineQueue
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
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
)

@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val repository: DownloadRepository,
    private val playbackStarter: PlaybackStarter,
) : ViewModel() {

    val uiState: StateFlow<DownloadsUiState> = combine(
        repository.downloadedSongs,
        repository.containersWithCount,
        repository.states,
    ) { songs, containers, states ->
        DownloadsUiState(songs = songs, containers = containers, states = states)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DownloadsUiState())

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message

    fun play(songId: String) {
        viewModelScope.launch {
            val songs = repository.downloadedSongs.first()
            if (songs.isEmpty()) return@launch
            playbackStarter.startOfflineQueue(
                materializeOfflineQueue(
                    songs = songs,
                    sourceType = "downloads",
                    sourceId = null,
                    startSongId = songId,
                ),
                playWhenReady = true,
            )
        }
    }

    fun removeSong(songId: String) {
        viewModelScope.launch { repository.removeSong(songId) }
    }

    fun removeContainer(containerId: String) {
        viewModelScope.launch { repository.removeContainer(containerId) }
    }

    fun pauseAll() = repository.pauseAll()

    fun resumeAll() = repository.resumeAll()

    fun clearAll() {
        viewModelScope.launch {
            repository.clearAll()
            _message.value = "Downloads cleared"
        }
    }

    fun dismissMessage() {
        _message.value = null
    }
}
