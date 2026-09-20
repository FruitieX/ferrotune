package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

enum class SearchTab {
    SONGS,
    ALBUMS,
    ARTISTS,
}

data class SearchUiState(
    val query: String = "",
    val tab: SearchTab = SearchTab.SONGS,
    val playbackError: String? = null,
)

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = state

    private val debouncedQuery = state
        .map { it.query.trim() }
        .debounce(SEARCH_DEBOUNCE_MS)
        .distinctUntilChanged()

    val songs: Flow<PagingData<SongResponse>> = debouncedQuery
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                flowOf(PagingData.empty())
            } else {
                Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                    repository.songs(query = query)
                }.flow
            }
        }
        .cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> = debouncedQuery
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                flowOf(PagingData.empty())
            } else {
                Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                    repository.albums(query = query)
                }.flow
            }
        }
        .cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> = debouncedQuery
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                flowOf(PagingData.empty())
            } else {
                Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                    repository.artists(query = query)
                }.flow
            }
        }
        .cachedIn(viewModelScope)

    fun onQueryChange(query: String) = state.update { it.copy(query = query) }

    fun selectTab(tab: SearchTab) = state.update { it.copy(tab = tab) }

    fun playSong(songId: String) {
        val query = state.value.query.trim()
        if (query.isEmpty()) return
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "search",
                        sourceName = "Search: $query",
                        filters = mapOf("query" to JsonPrimitive(query)),
                        sort = queueSort("name", "asc"),
                        startSongId = songId,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 300L
    }
}

@Composable
fun SearchScreen(
    onOpenAlbum: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(title = { Text("Search") })
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                placeholder = { Text("Songs, albums, artists") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = ImeAction.Search,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
            TabRow(selectedTabIndex = state.tab.ordinal) {
                SearchTab.entries.forEach { tab ->
                    Tab(
                        selected = tab == state.tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = { Text(tab.label()) },
                    )
                }
            }
            if (state.query.isBlank()) {
                EmptyState("Type to search your library")
            } else {
                when (state.tab) {
                    SearchTab.SONGS -> PagedSongList(
                        items = viewModel.songs.collectAsLazyPagingItems(),
                        onPlaySong = viewModel::playSong,
                        onOpenSongRadio = onOpenSongRadio,
                    )

                    SearchTab.ALBUMS -> PagedAlbumGrid(
                        items = viewModel.albums.collectAsLazyPagingItems(),
                        onOpenAlbum = onOpenAlbum,
                    )

                    SearchTab.ARTISTS -> PagedArtistList(
                        items = viewModel.artists.collectAsLazyPagingItems(),
                        onOpenArtist = onOpenArtist,
                    )
                }
            }
        }
    }
}

private fun SearchTab.label(): String = when (this) {
    SearchTab.SONGS -> "Songs"
    SearchTab.ALBUMS -> "Albums"
    SearchTab.ARTISTS -> "Artists"
}
