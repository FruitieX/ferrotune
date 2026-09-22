package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.RecentPlaylistEntry
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.feature.playlists.data.PlaylistRepository
import com.ferrotune.feature.playlists.data.PlaylistTree
import com.ferrotune.feature.playlists.data.buildPlaylistTree
import com.ferrotune.feature.playlists.data.folderById
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

data class PlaylistsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val serverUrl: String? = null,
    val tree: PlaylistTree = PlaylistTree(rootPlaylists = emptyList(), folders = emptyList()),
    val smartPlaylists: List<SmartPlaylistInfo> = emptyList(),
    val recentlyPlayed: List<RecentPlaylistEntry> = emptyList(),
    val playbackError: String? = null,
    val currentFolderId: String? = null,
)

@HiltViewModel
class PlaylistsViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(PlaylistsUiState())
    val uiState: StateFlow<PlaylistsUiState> = state.asStateFlow()

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val loaded = coroutineScope {
                    val foldersDeferred = async { repository.folders() }
                    val smartDeferred = async { repository.smartPlaylists() }
                    val recentDeferred = async { repository.recentlyPlayed() }
                    val serverUrlDeferred = async { repository.activeServerUrl() }
                    LoadedPlaylists(
                        folders = foldersDeferred.await(),
                        smart = smartDeferred.await(),
                        recent = recentDeferred.await(),
                        serverUrl = serverUrlDeferred.await(),
                    )
                }
                state.update {
                    val tree = buildPlaylistTree(
                        loaded.folders.folders,
                        loaded.folders.playlists,
                    )
                    it.copy(
                        loading = false,
                        serverUrl = loaded.serverUrl,
                        tree = tree,
                        smartPlaylists = loaded.smart.smartPlaylists,
                        recentlyPlayed = loaded.recent.playlists,
                        // Fall back to the root when the open folder disappeared.
                        currentFolderId = it.currentFolderId?.takeIf { id ->
                            tree.folderById(id) != null
                        },
                    )
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load playlists")
                }
            }
        }
    }

    fun createFolder(name: String, parentId: String? = null) = mutate {
        repository.createFolder(name, parentId)
    }

    /** Opens a folder for browsing; `null` navigates back to the root. */
    fun openFolder(folderId: String?) = state.update { it.copy(currentFolderId = folderId) }

    /** Navigates one level up from the open folder. */
    fun navigateUp() {
        val current = state.value.tree.folderById(state.value.currentFolderId) ?: return
        openFolder(current.folder.parentId)
    }

    fun renameFolder(folderId: String, name: String) = mutate {
        repository.updateFolder(folderId, name = name)
    }

    fun moveFolder(folderId: String, parentId: String?) = mutate {
        repository.updateFolder(
            folderId,
            parentId = parentId?.let { JsonPrimitive(it) } ?: JsonNull,
        )
    }

    fun deleteFolder(folderId: String) = mutate {
        repository.deleteFolder(folderId)
    }

    fun createPlaylist(name: String, folderId: String? = null) = mutate {
        repository.createPlaylist(name = name, folderId = folderId)
    }

    fun renamePlaylist(playlistId: String, name: String) = mutate {
        repository.updatePlaylist(playlistId, name = name)
    }

    fun movePlaylist(playlistId: String, folderId: String?) = mutate {
        repository.movePlaylist(playlistId, folderId)
    }

    fun deletePlaylist(playlistId: String) = mutate {
        repository.deletePlaylist(playlistId)
    }

    fun playPlaylist(playlist: PlaylistInFolder, shuffle: Boolean) {
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_PLAYLIST,
                sourceId = playlist.id,
                sourceName = playlist.name,
                shuffle = shuffle,
            )
        )
    }

    fun playSmartPlaylist(smartPlaylist: SmartPlaylistInfo, shuffle: Boolean) {
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_SMART_PLAYLIST,
                sourceId = smartPlaylist.id,
                sourceName = smartPlaylist.name,
                shuffle = shuffle,
            )
        )
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private fun mutate(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                load()
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Request failed") }
            }
        }
    }

    private fun startQueue(spec: QueueStartSpec) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(spec)
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    private companion object {
        const val SOURCE_TYPE_PLAYLIST = "playlist"
        const val SOURCE_TYPE_SMART_PLAYLIST = "smartPlaylist"
    }
}

private data class LoadedPlaylists(
    val folders: com.ferrotune.core.network.generated.PlaylistFoldersResponse,
    val smart: com.ferrotune.core.network.generated.SmartPlaylistsResponse,
    val recent: com.ferrotune.core.network.generated.RecentPlaylistsResponse,
    val serverUrl: String,
)
