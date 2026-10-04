package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.feature.playlists.data.PlaylistFolderNode
import com.ferrotune.feature.playlists.data.PlaylistRepository
import com.ferrotune.feature.playlists.data.PlaylistTree
import com.ferrotune.feature.playlists.data.buildPlaylistTree
import com.ferrotune.feature.playlists.data.folderById
import com.ferrotune.feature.playlists.data.foldersIn
import com.ferrotune.feature.playlists.data.playlistsIn
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

/** Web playlists toolbar sort fields. */
enum class PlaylistsSort(val label: String) {
    NAME("Name"),
    SONG_COUNT("Song count"),
    DURATION("Duration"),
    DATE_ADDED("Date created"),
}

data class PlaylistsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val serverUrl: String? = null,
    val tree: PlaylistTree = PlaylistTree(rootPlaylists = emptyList(), folders = emptyList()),
    val smartPlaylists: List<SmartPlaylistInfo> = emptyList(),
    val currentFolderId: String? = null,
    val filter: String = "",
    val sort: PlaylistsSort = PlaylistsSort.NAME,
    val ascending: Boolean = true,
)

/** One tile in the playlists browser grid. */
sealed interface PlaylistBrowserItem {
    val key: String

    data class Folder(val node: PlaylistFolderNode, val playlistCount: Int) : PlaylistBrowserItem {
        override val key = "folder-${node.folder.id}"
    }

    data class Playlist(val playlist: PlaylistInFolder) : PlaylistBrowserItem {
        override val key = "playlist-${playlist.id}"
    }

    data class Smart(val smartPlaylist: SmartPlaylistInfo) : PlaylistBrowserItem {
        override val key = "smart-${smartPlaylist.id}"
    }
}

/**
 * The open folder's contents as the web shows them: subfolders first, then
 * playlists and smart playlists together, filtered by name and sorted by the
 * toolbar sort. The whole folder tree is already loaded, so this is local.
 */
fun PlaylistsUiState.browserItems(): List<PlaylistBrowserItem> {
    val query = filter.trim()
    fun matches(name: String) = query.isEmpty() || name.contains(query, ignoreCase = true)

    val folders = tree.foldersIn(currentFolderId)
        .filter { matches(it.folder.name) }
        .map { node ->
            PlaylistBrowserItem.Folder(
                node = node,
                playlistCount = node.playlists.size + smartPlaylists.count { it.folderId == node.folder.id },
            )
        }
    val playlists: List<PlaylistBrowserItem> =
        tree.playlistsIn(currentFolderId).filter { matches(it.name) }.map { PlaylistBrowserItem.Playlist(it) } +
            smartPlaylists.filter { it.folderId == currentFolderId && matches(it.name) }
                .map { PlaylistBrowserItem.Smart(it) }

    val comparator: Comparator<PlaylistBrowserItem> = when (sort) {
        PlaylistsSort.NAME -> compareBy(String.CASE_INSENSITIVE_ORDER) { it.name() }
        PlaylistsSort.SONG_COUNT -> compareBy { it.songCount() }
        PlaylistsSort.DURATION -> compareBy { it.duration() }
        PlaylistsSort.DATE_ADDED -> compareBy { it.created() }
    }
    val sorted = playlists.sortedWith(if (ascending) comparator else comparator.reversed())
    return folders + sorted
}

private fun PlaylistBrowserItem.name(): String = when (this) {
    is PlaylistBrowserItem.Folder -> node.folder.name
    is PlaylistBrowserItem.Playlist -> playlist.name
    is PlaylistBrowserItem.Smart -> smartPlaylist.name
}

private fun PlaylistBrowserItem.songCount(): Long = when (this) {
    is PlaylistBrowserItem.Folder -> 0
    is PlaylistBrowserItem.Playlist -> playlist.songCount
    is PlaylistBrowserItem.Smart -> smartPlaylist.songCount ?: 0
}

private fun PlaylistBrowserItem.duration(): Long = when (this) {
    is PlaylistBrowserItem.Playlist -> playlist.duration
    else -> 0
}

private fun PlaylistBrowserItem.created(): String = when (this) {
    is PlaylistBrowserItem.Folder -> node.folder.createdAt
    is PlaylistBrowserItem.Playlist -> playlist.created
    is PlaylistBrowserItem.Smart -> smartPlaylist.createdAt
}

@HiltViewModel
class PlaylistsViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    private val sessionStarter: PlaybackStarter,
    private val messages: UserMessages,
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
                    val serverUrlDeferred = async { repository.activeServerUrl() }
                    Triple(foldersDeferred.await(), smartDeferred.await(), serverUrlDeferred.await())
                }
                val (folders, smart, serverUrl) = loaded
                state.update {
                    val tree = buildPlaylistTree(folders.folders, folders.playlists)
                    it.copy(
                        loading = false,
                        serverUrl = serverUrl,
                        tree = tree,
                        smartPlaylists = smart.smartPlaylists,
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

    /** Opens a folder for browsing; `null` navigates back to the root. */
    fun openFolder(folderId: String?) = state.update { it.copy(currentFolderId = folderId, filter = "") }

    /** Navigates one level up from the open folder; false when already at the root. */
    fun navigateUp(): Boolean {
        val current = state.value.tree.folderById(state.value.currentFolderId) ?: return false
        openFolder(current.folder.parentId)
        return true
    }

    fun setFilter(value: String) = state.update { it.copy(filter = value) }

    fun selectSort(sort: PlaylistsSort) = state.update { it.copy(sort = sort, ascending = true) }

    fun toggleSortDirection() = state.update { it.copy(ascending = !it.ascending) }

    fun createFolder(name: String, parentId: String? = null) = mutate("Couldn't create folder") {
        repository.createFolder(name, parentId)
    }

    fun renameFolder(folderId: String, name: String) = mutate("Couldn't rename folder") {
        repository.updateFolder(folderId, name = name)
    }

    fun moveFolder(folderId: String, parentId: String?) = mutate("Couldn't move folder") {
        repository.updateFolder(
            folderId,
            parentId = parentId?.let { JsonPrimitive(it) } ?: JsonNull,
        )
    }

    fun deleteFolder(folderId: String) = mutate("Couldn't delete folder") {
        repository.deleteFolder(folderId)
    }

    fun createPlaylist(name: String, folderId: String? = null) = mutate("Couldn't create playlist") {
        repository.createPlaylist(name = name, folderId = folderId)
    }

    fun renamePlaylist(playlistId: String, name: String) = mutate("Couldn't rename playlist") {
        repository.updatePlaylist(playlistId, name = name)
    }

    fun movePlaylist(playlistId: String, folderId: String?) = mutate("Couldn't move playlist") {
        repository.movePlaylist(playlistId, folderId)
    }

    fun deletePlaylist(playlistId: String) = mutate("Couldn't delete playlist") {
        repository.deletePlaylist(playlistId)
    }

    /**
     * Plays every playlist shown in the open folder back to back (the web
     * action bar's play/shuffle with nothing selected); the server
     * concatenates the sources and drops duplicate songs.
     */
    fun playAll(shuffle: Boolean) {
        val sources = state.value.browserItems().mapNotNull { item ->
            when (item) {
                is PlaylistBrowserItem.Playlist -> QueueSourceRequest(
                    sourceType = SOURCE_TYPE_PLAYLIST,
                    sourceId = item.playlist.id,
                )

                is PlaylistBrowserItem.Smart -> QueueSourceRequest(
                    sourceType = SOURCE_TYPE_SMART_PLAYLIST,
                    sourceId = item.smartPlaylist.id,
                )

                is PlaylistBrowserItem.Folder -> null
            }
        }
        if (sources.isEmpty()) return
        val folderName = state.value.tree.folderById(state.value.currentFolderId)?.folder?.name
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "other",
                        sourceName = folderName ?: "Playlists",
                        sources = sources,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    private fun mutate(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { load() }
                .onFailure { messages.failure(failure, it) }
        }
    }

    private companion object {
        const val SOURCE_TYPE_PLAYLIST = "playlist"
        const val SOURCE_TYPE_SMART_PLAYLIST = "smartPlaylist"
    }
}
