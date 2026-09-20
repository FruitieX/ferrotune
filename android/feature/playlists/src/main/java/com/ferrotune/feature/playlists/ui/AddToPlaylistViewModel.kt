package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.feature.playlists.data.PlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AddToPlaylistUiState(
    val loading: Boolean = true,
    val saving: Boolean = false,
    val error: String? = null,
    val added: Boolean = false,
    val query: String = "",
    val playlists: List<PlaylistInFolder> = emptyList(),
) {
    val visiblePlaylists: List<PlaylistInFolder>
        get() = playlists
            .filter { it.canEdit }
            .filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
            .sortedBy { it.name.lowercase() }
}

@HiltViewModel
class AddToPlaylistViewModel @Inject constructor(
    private val repository: PlaylistRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddToPlaylistUiState())
    val uiState: StateFlow<AddToPlaylistUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            try {
                val playlists = repository.folders().playlists
                _uiState.update { it.copy(loading = false, error = null, playlists = playlists) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load playlists")
                }
            }
        }
    }

    fun setQuery(value: String) = _uiState.update { it.copy(query = value) }

    fun add(songIds: List<String>, playlistId: String) {
        if (songIds.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(saving = true, error = null) }
            try {
                repository.addSongs(playlistId, songIds)
                _uiState.update { it.copy(saving = false, added = true) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(saving = false, error = e.message ?: "Failed to add songs")
                }
            }
        }
    }
}
