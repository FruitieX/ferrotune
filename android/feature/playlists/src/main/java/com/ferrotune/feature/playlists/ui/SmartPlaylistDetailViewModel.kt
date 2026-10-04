package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.media.queueTextFilter
import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.waitFor
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.SmartPlaylistInfo
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.ViewSortConfig
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
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
import kotlinx.coroutines.withTimeoutOrNull

data class SmartPlaylistDetailUiState(
    val smartPlaylist: SmartPlaylistInfo? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val filter: String = "",
    val sort: String = PlaylistRepository.PLAYLIST_SORT_CUSTOM,
    val sortDir: String = "asc",
    val deleted: Boolean = false,
    val materializedPlaylistId: String? = null,
)

@HiltViewModel
class SmartPlaylistDetailViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewSortPreferences: ViewSortPreferencesRepository,
    private val messages: UserMessages,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val smartPlaylistId: String = checkNotNull(savedStateHandle["smartPlaylistId"])

    private val state = MutableStateFlow(SmartPlaylistDetailUiState())
    val uiState: StateFlow<SmartPlaylistDetailUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")
    private val sortReady = MutableStateFlow(false)

    @OptIn(kotlinx.coroutines.FlowPreview::class)
    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.sort to it.sortDir }.distinctUntilChanged(),
        filter.debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged(),
    ) { (sort, sortDir), filter -> Triple(sort, sortDir, filter) }
        .waitFor(sortReady)
        .flatMapLatest { (sort, sortDir, filter) ->
            Pager(PagingConfig(pageSize = DEFAULT_PAGE_SIZE)) {
                repository.smartPlaylistSongs(
                    smartPlaylistId,
                    filter = filter.ifBlank { null },
                    sortField = sort.takeIf { it != PlaylistRepository.PLAYLIST_SORT_CUSTOM },
                    sortDirection = sortDir,
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        load()
        viewModelScope.launch {
            withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { viewSortPreferences.ensureLoaded() }
            val stored = viewSortPreferences.config(
                ViewSortKey.PLAYLIST_DETAIL,
                ViewSortConfig(PlaylistRepository.PLAYLIST_SORT_CUSTOM, "asc"),
            )
            state.update {
                it.copy(
                    sort = stored.field.takeIf { field ->
                        playlistSortOptions.any { it.key == field }
                    } ?: PlaylistRepository.PLAYLIST_SORT_CUSTOM,
                    sortDir = stored.direction.takeIf { direction ->
                        direction == "asc" || direction == "desc"
                    } ?: "asc",
                )
            }
            sortReady.value = true
        }
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val smartPlaylist = repository.smartPlaylist(smartPlaylistId)
                val serverUrl = repository.activeServerUrl()
                state.update {
                    it.copy(smartPlaylist = smartPlaylist, serverUrl = serverUrl, loading = false)
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load smart playlist")
                }
            }
        }
    }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(sort: String) {
        state.update { it.copy(sort = sort) }
        persistSort()
    }

    fun toggleSortDir() {
        state.update { it.copy(sortDir = if (it.sortDir == "asc") "desc" else "asc") }
        persistSort()
    }

    private fun persistSort() {
        val current = state.value
        viewModelScope.launch {
            viewSortPreferences.setSort(
                ViewSortKey.PLAYLIST_DETAIL,
                current.sort,
                current.sortDir,
            )
        }
    }

    /** Plays the smart playlist as listed (filter and sort included). */
    fun play(startSongId: String? = null, startIndex: Int = 0, shuffle: Boolean = false) {
        val current = state.value
        val smartPlaylist = current.smartPlaylist ?: return
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_SMART_PLAYLIST,
                        sourceId = smartPlaylist.id,
                        sourceName = smartPlaylist.name,
                        filters = queueTextFilter(current.filter),
                        sort = current.sort
                            .takeIf { it != PlaylistRepository.PLAYLIST_SORT_CUSTOM }
                            ?.let { queueSort(it, current.sortDir) },
                        startSongId = startSongId,
                        startIndex = startIndex,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    fun materialize() {
        viewModelScope.launch {
            try {
                val response = repository.materializeSmartPlaylist(smartPlaylistId)
                state.update { it.copy(materializedPlaylistId = response.playlistId) }
            } catch (e: Exception) {
                messages.failure("Couldn't create playlist", e)
            }
        }
    }

    fun deleteSmartPlaylist() {
        viewModelScope.launch {
            try {
                repository.deleteSmartPlaylist(smartPlaylistId)
                state.update { it.copy(deleted = true) }
            } catch (e: Exception) {
                messages.failure("Couldn't delete smart playlist", e)
            }
        }
    }

    private companion object {
        const val SOURCE_TYPE_SMART_PLAYLIST = "smartPlaylist"
    }
}
