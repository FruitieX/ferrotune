package com.ferrotune.feature.library.ui

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
import com.ferrotune.core.network.generated.AlbumDetail
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
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

data class AlbumDetailUiState(
    val album: AlbumDetail? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val filter: String = "",
    val sort: String = CUSTOM_SORT,
    val sortDir: SortDir = SortDir.ASC,
    val playbackError: String? = null,
)

@HiltViewModel
class AlbumDetailViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val albumId: String = checkNotNull(savedStateHandle["albumId"])

    private val state = MutableStateFlow(AlbumDetailUiState())
    val uiState: StateFlow<AlbumDetailUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")

    @OptIn(kotlinx.coroutines.FlowPreview::class)
    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.sort to it.sortDir }.distinctUntilChanged(),
        filter.debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged(),
    ) { (sort, sortDir), filter -> Triple(sort, sortDir, filter) }
        .flatMapLatest { (sort, sortDir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.albumSongs(
                    albumId,
                    sort = SongSort.entries.firstOrNull { it.apiValue == sort },
                    sortDir = sortDir,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        viewModelScope.launch {
            try {
                val album = repository.album(albumId).album
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(album = album, serverUrl = serverUrl, loading = false) }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e.message ?: "Failed to load album") }
            }
        }
    }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(key: String) = state.update { it.copy(sort = key) }

    fun toggleSortDir() = state.update { it.copy(sortDir = it.sortDir.opposite()) }

    fun play(startSongId: String? = null, shuffle: Boolean = false) {
        viewModelScope.launch {
            val album = state.value.album ?: return@launch
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "album",
                        sourceId = albumId,
                        sourceName = album.name,
                        sort = state.value.sort
                            .takeIf { it != CUSTOM_SORT }
                            ?.let { queueSort(it, state.value.sortDir.apiValue) },
                        startSongId = startSongId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}
