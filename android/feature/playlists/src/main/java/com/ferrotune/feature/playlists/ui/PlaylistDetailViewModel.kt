package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.PlaylistSongEntry
import com.ferrotune.core.network.generated.PlaylistSongsResponse
import com.ferrotune.core.network.generated.ShareEntry
import com.ferrotune.core.network.generated.ShareableUser
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.feature.playlists.data.PlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PlaylistDetailUiState(
    val playlist: PlaylistSongsResponse? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val sort: String = PlaylistRepository.PLAYLIST_SORT_CUSTOM,
    val sortDir: String = "asc",
    val filter: String = "",
    val revision: Int = 0,
    val deleted: Boolean = false,
    val playbackError: String? = null,
)

data class PlaylistSharesUiState(
    val loading: Boolean = false,
    val users: List<ShareableUser> = emptyList(),
    val shares: Map<Long, Boolean> = emptyMap(),
    val error: String? = null,
)

@HiltViewModel
class PlaylistDetailViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    private val sessionStarter: PlaybackStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val playlistId: String = checkNotNull(savedStateHandle["playlistId"])

    private val state = MutableStateFlow(PlaylistDetailUiState())
    val uiState: StateFlow<PlaylistDetailUiState> = state.asStateFlow()

    private val shareState = MutableStateFlow(PlaylistSharesUiState())
    val shares: StateFlow<PlaylistSharesUiState> = shareState.asStateFlow()

    private val filter = MutableStateFlow("")

    @OptIn(kotlinx.coroutines.FlowPreview::class)
    val entries: Flow<PagingData<PlaylistSongEntry>> = combine(
        state.map { Triple(it.sort, it.sortDir, it.revision) }.distinctUntilChanged(),
        filter.debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged(),
    ) { (sort, sortDir, _), filter -> Triple(sort, sortDir, filter) }
        .flatMapLatest { (sort, sortDir, filter) ->
            Pager(PagingConfig(pageSize = DEFAULT_PAGE_SIZE)) {
                repository.playlistSongs(
                    playlistId,
                    sort = sort,
                    sortDir = sortDir,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val playlist = repository.playlist(playlistId)
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(playlist = playlist, serverUrl = serverUrl, loading = false) }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load playlist")
                }
            }
        }
    }

    fun selectSort(sort: String) = state.update { it.copy(sort = sort) }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun toggleSortDir() = state.update {
        it.copy(sortDir = if (it.sortDir == "asc") "desc" else "asc")
    }

    fun play(startSongId: String? = null, shuffle: Boolean = false) {
        val playlist = state.value.playlist ?: return
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_PLAYLIST,
                        sourceId = playlist.id,
                        sourceName = playlist.name,
                        sort = queueSort(state.value.sort, state.value.sortDir),
                        startSongId = startSongId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun updateDetails(name: String? = null, comment: String? = null, public: Boolean? = null) =
        mutate {
            repository.updatePlaylist(playlistId, name = name, comment = comment, public = public)
        }

    fun addSongs(songIds: List<String>) = mutate {
        repository.addSongs(playlistId, songIds)
    }

    fun removeEntry(entry: PlaylistSongEntry) = mutate {
        repository.removeSongs(playlistId, listOf(entry.position))
    }

    fun removeEntries(entries: List<PlaylistSongEntry>) = mutate {
        repository.removeSongs(playlistId, entries.map { it.position })
    }

    fun moveEntry(entry: PlaylistSongEntry, toPosition: Int) = mutate {
        repository.moveEntry(playlistId, entry.entryId, toPosition)
    }

    fun deletePlaylist() {
        viewModelScope.launch {
            try {
                repository.deletePlaylist(playlistId)
                state.update { it.copy(deleted = true) }
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Failed to delete playlist") }
            }
        }
    }

    fun loadShares() {
        shareState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val users = repository.shareableUsers()
                val shares = repository.shares(playlistId).shares
                shareState.update {
                    it.copy(
                        loading = false,
                        users = users,
                        shares = shares.associate { share -> share.userId to share.canEdit },
                    )
                }
            } catch (e: Exception) {
                shareState.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load shares")
                }
            }
        }
    }

    fun toggleShare(userId: Long, canEdit: Boolean = false) {
        shareState.update {
            val shares = it.shares.toMutableMap()
            if (shares.containsKey(userId)) {
                shares.remove(userId)
            } else {
                shares[userId] = canEdit
            }
            it.copy(shares = shares)
        }
    }

    fun setShareCanEdit(userId: Long, canEdit: Boolean) {
        shareState.update {
            if (!it.shares.containsKey(userId)) {
                it
            } else {
                it.copy(shares = it.shares + (userId to canEdit))
            }
        }
    }

    fun saveShares() {
        viewModelScope.launch {
            try {
                repository.setShares(
                    playlistId,
                    shareState.value.shares.map { (userId, canEdit) ->
                        ShareEntry(userId = userId, canEdit = canEdit)
                    },
                )
                loadShares()
            } catch (e: Exception) {
                shareState.update { it.copy(error = e.message ?: "Failed to save shares") }
            }
        }
    }

    fun dismissSharesError() = shareState.update { it.copy(error = null) }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private fun mutate(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                state.update { it.copy(revision = it.revision + 1) }
                load()
            } catch (e: Exception) {
                state.update { it.copy(error = e.message ?: "Request failed") }
            }
        }
    }

    private companion object {
        const val SOURCE_TYPE_PLAYLIST = "playlist"
    }
}
