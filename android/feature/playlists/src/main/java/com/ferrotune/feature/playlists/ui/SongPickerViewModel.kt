package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.feature.playlists.data.PlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

data class SongPickerUiState(
    val query: String = "",
)

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class SongPickerViewModel @Inject constructor(
    private val repository: PlaylistRepository,
) : ViewModel() {

    private val state = MutableStateFlow(SongPickerUiState())
    val uiState: StateFlow<SongPickerUiState> = state

    val results: Flow<PagingData<SongResponse>> = state
        .map { it.query.trim() }
        .debounce(SEARCH_DEBOUNCE_MS)
        .distinctUntilChanged()
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                flowOf(PagingData.empty())
            } else {
                Pager(PagingConfig(pageSize = DEFAULT_PAGE_SIZE)) {
                    repository.searchSongs(query)
                }.flow
            }
        }
        .cachedIn(viewModelScope)

    fun onQueryChange(query: String) = state.update { it.copy(query = query) }

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 300L
    }
}
