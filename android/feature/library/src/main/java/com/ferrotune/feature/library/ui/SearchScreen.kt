package com.ferrotune.feature.library.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
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
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionMenuState
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.NowPlaying
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongListRow
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongMenuState
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionState
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.SearchField
import com.ferrotune.core.designsystem.components.SegmentedTabs
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.FerrotuneSearchContent
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/** Web search tabs. */
enum class SearchTab(val label: String) {
    ALL("All"),
    ARTISTS("Artists"),
    ALBUMS("Albums"),
    SONGS("Songs"),
    GENRES("Genres"),
}

data class SearchUiState(
    val query: String = "",
    val tab: SearchTab = SearchTab.ALL,
)

/** "All" tab results: previews plus totals for the tab labels. */
sealed interface SearchOverview {
    data object Idle : SearchOverview
    data object Loading : SearchOverview
    data class Loaded(val content: FerrotuneSearchContent, val genres: List<GenreResponse>) : SearchOverview
    data class Failed(val message: String) : SearchOverview
}

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val messages: UserMessages,
) : ViewModel() {

    private val state = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = state

    private val debouncedQuery = state
        .map { it.query.trim() }
        .debounce { if (it.isEmpty()) 0L else SEARCH_DEBOUNCE_MS }
        .distinctUntilChanged()

    private var allGenres: List<GenreResponse>? = null

    val overview: StateFlow<SearchOverview> = debouncedQuery
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                flowOf(SearchOverview.Idle)
            } else {
                flowOf(query).mapLatest { q ->
                    runCatching {
                        val genres = allGenres ?: repository.genres().also { allGenres = it }
                        SearchOverview.Loaded(
                            content = repository.searchOverview(q),
                            genres = genres.filter { it.value.contains(q, ignoreCase = true) },
                        )
                    }.getOrElse { SearchOverview.Failed(it.message ?: "Search failed") }
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchOverview.Idle)

    val songs: Flow<PagingData<SongResponse>> = debouncedQuery.pagedFor { repository.songs(query = it) }
    val albums: Flow<PagingData<AlbumResponse>> = debouncedQuery.pagedFor { repository.albums(query = it) }
    val artists: Flow<PagingData<ArtistResponse>> = debouncedQuery.pagedFor { repository.artists(query = it) }

    private fun <T : Any> Flow<String>.pagedFor(
        source: (String) -> androidx.paging.PagingSource<Int, T>,
    ): Flow<PagingData<T>> = flatMapLatest { query ->
        if (query.isEmpty()) {
            flowOf(PagingData.empty())
        } else {
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) { source(query) }.flow
        }
    }.cachedIn(viewModelScope)

    fun onQueryChange(query: String) = state.update { it.copy(query = query) }

    fun selectTab(tab: SearchTab) = state.update { it.copy(tab = tab) }

    /** Plays the song results (title order, like the list) from [songId]. */
    fun playSong(songId: String, position: Int) {
        val query = state.value.query.trim()
        if (query.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "search",
                        sourceName = "Search: $query",
                        filters = mapOf("query" to JsonPrimitive(query)),
                        sort = queueSort(SongSort.TITLE.apiValue, SortDir.ASC.apiValue),
                        startSongId = songId,
                        startIndex = position,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 300L
    }
}

/**
 * Web search page: a large search field, "All / Artists / Albums / Songs /
 * Genres" tabs with result counts, an "All" overview with a few results per
 * type, and full paged lists per tab.
 */
@Composable
fun SearchScreen(
    modifier: Modifier = Modifier,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val overview by viewModel.overview.collectAsStateWithLifecycle()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    val loaded = overview as? SearchOverview.Loaded
    // Paged results are only collected (and fetched) for the visible tab.
    val songs = if (state.tab == SearchTab.SONGS) viewModel.songs.collectAsLazyPagingItems() else null
    val albums = if (state.tab == SearchTab.ALBUMS) viewModel.albums.collectAsLazyPagingItems() else null
    val artists = if (state.tab == SearchTab.ARTISTS) viewModel.artists.collectAsLazyPagingItems() else null

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = modifier,
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = {
                        actionsViewModel.loadAllIds(
                            searchParams = SearchParams(
                                query = state.query.trim(),
                                songSort = SongSort.TITLE.apiValue,
                                songSortDir = SortDir.ASC.apiValue,
                            ),
                            onLoaded = selection::replace,
                        )
                    },
                    selectingAll = selectingAll,
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.background)
                        .statusBarsPadding(),
                ) {
                    SearchField(
                        value = state.query,
                        onValueChange = {
                            selection.clear()
                            viewModel.onQueryChange(it)
                        },
                        placeholder = "Search for artists, albums, or songs...",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                    if (state.query.isNotBlank()) {
                        SegmentedTabs(
                            labels = SearchTab.entries.map { tab -> tab.label + loaded.countFor(tab) },
                            selectedIndex = state.tab.ordinal,
                            onSelect = { viewModel.selectTab(SearchTab.entries[it]) },
                            scrollable = true,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        },
        bottomBar = {
            if (selection.isActive) {
                SongSelectionActionBar(
                    selectedIds = selection.selectedIds.toList(),
                    onClearSelection = selection::clear,
                    viewModel = actionsViewModel,
                )
            }
        },
    ) { padding ->
        val columns = gridColumns()
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                state.query.isBlank() -> item(key = "idle") {
                    EmptyState(
                        message = "Search your library",
                        icon = Icons.Filled.Search,
                        description = "Find artists, albums, and songs",
                    )
                }

                state.tab == SearchTab.ALL -> overviewItems(
                    overview = overview,
                    columns = columns,
                    nowPlaying = nowPlaying,
                    songMenu = songMenu,
                    collectionMenu = collectionMenu,
                    selection = selection,
                    onPlaySong = viewModel::playSong,
                    onSeeAll = viewModel::selectTab,
                )

                songs != null -> songPagingItems(
                    songs = songs,
                    nowPlaying = nowPlaying,
                    menu = songMenu,
                    selection = selection,
                    onPlay = { song, position -> viewModel.playSong(song.id, position) },
                    emptyMessage = "No songs found",
                    emptyIcon = Icons.Filled.SearchOff,
                    index = null,
                )

                albums != null -> {
                    item(key = "albums-spacer") { Spacer(Modifier.padding(top = 6.dp)) }
                    pagedCardRows(albums, columns, "albums", "No albums found") { album ->
                        AlbumCard(album, collectionMenu, Modifier.weight(1f))
                    }
                }

                artists != null -> {
                    item(key = "artists-spacer") { Spacer(Modifier.padding(top = 6.dp)) }
                    pagedCardRows(artists, columns, "artists", "No artists found") { artist ->
                        ArtistCard(artist, collectionMenu, Modifier.weight(1f))
                    }
                }

                state.tab == SearchTab.GENRES -> {
                    val genres = loaded?.genres.orEmpty()
                    if (genres.isEmpty()) {
                        item(key = "genres-empty") { EmptyState("No genres found") }
                    } else {
                        genreRows(genres, columns)
                    }
                }
            }
        }
    }

    SongMenuSheet(state = songMenu, onStartSelection = { selection.select(it.id) })
    CollectionMenuSheet(state = collectionMenu)
}

private fun SearchOverview.Loaded?.countFor(tab: SearchTab): String {
    val content = this?.content ?: return ""
    val count = when (tab) {
        SearchTab.ALL -> return ""
        SearchTab.ARTISTS -> content.artistTotal ?: content.artist.size.toLong()
        SearchTab.ALBUMS -> content.albumTotal ?: content.album.size.toLong()
        SearchTab.SONGS -> content.songTotal ?: content.song.size.toLong()
        SearchTab.GENRES -> genres.size.toLong()
    }
    return " ($count)"
}



private fun LazyListScope.overviewItems(
    overview: SearchOverview,
    columns: Int,
    nowPlaying: NowPlaying,
    songMenu: SongMenuState,
    collectionMenu: CollectionMenuState,
    selection: SongSelectionState,
    onPlaySong: (String, Int) -> Unit,
    onSeeAll: (SearchTab) -> Unit,
) {
    when (overview) {
        SearchOverview.Idle, SearchOverview.Loading -> item(key = "overview-loading") {
            MediaRowSkeletonList(count = 8)
        }

        is SearchOverview.Failed -> item(key = "overview-error") {
            EmptyState(message = overview.message, icon = Icons.Filled.SearchOff)
        }

        is SearchOverview.Loaded -> {
            val content = overview.content
            if (content.artist.isEmpty() && content.album.isEmpty() && content.song.isEmpty() && overview.genres.isEmpty()) {
                item(key = "no-results") {
                    EmptyState(
                        message = "No results found",
                        icon = Icons.Filled.SearchOff,
                        description = "Try a different search term",
                    )
                }
                return
            }
            if (content.artist.isNotEmpty()) {
                item(key = "artists-title") { SectionTitle("Artists") }
                cardRows("artists", content.artist, columns) { artist ->
                    ArtistCard(artist, collectionMenu, Modifier.weight(1f))
                }
            }
            if (content.album.isNotEmpty()) {
                item(key = "albums-title") { SectionTitle("Albums") }
                cardRows("albums", content.album, columns) { album ->
                    AlbumCard(album, collectionMenu, Modifier.weight(1f))
                }
            }
            if (content.song.isNotEmpty()) {
                item(key = "songs-title") { SectionTitle("Songs") }
                itemsIndexed(content.song, key = { _, song -> "song-${song.id}" }) { index, song ->
                    SongListRow(
                        song = song,
                        nowPlaying = nowPlaying,
                        menu = songMenu,
                        selection = selection,
                        onPlay = { onPlaySong(song.id, index) },
                    )
                }
            }
            if (overview.genres.isNotEmpty()) {
                item(key = "genres-title") { SectionTitle("Genres") }
                genreRows(overview.genres.take(6), columns)
            }
        }
    }
}

private fun <T> LazyListScope.cardRows(
    keyPrefix: String,
    items: List<T>,
    columns: Int,
    card: @Composable androidx.compose.foundation.layout.RowScope.(T) -> Unit,
) {
    val rows = items.chunked(columns)
    rows.forEachIndexed { index, row ->
        item(key = "$keyPrefix-row-$index") {
            Row(
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { card(it) }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

private fun LazyListScope.genreRows(genres: List<GenreResponse>, columns: Int) {
    cardRows("genres", genres, columns) { genre ->
        GenreTile(genre, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun AlbumCard(album: AlbumResponse, collectionMenu: CollectionMenuState, modifier: Modifier) {
    val actions = LocalMediaActions.current
    MediaCard(
        title = album.name,
        subtitle = albumSubtitle(album),
        coverModel = coverModel(album.coverArtData, album.coverArt),
        seed = album.name,
        titleIcon = Icons.Filled.Album,
        onClick = { actions.openAlbum(album.id) },
        onLongClick = { collectionMenu.open(album.toCollectionTarget()) },
        modifier = modifier,
    )
}

@Composable
private fun ArtistCard(artist: ArtistResponse, collectionMenu: CollectionMenuState, modifier: Modifier) {
    val actions = LocalMediaActions.current
    MediaCard(
        title = artist.name,
        subtitle = artistCounts(artist),
        coverModel = coverModel(artist.coverArtData, artist.coverArt),
        seed = artist.name,
        circularCover = true,
        titleIcon = Icons.Filled.Person,
        onClick = { actions.openArtist(artist.id) },
        onLongClick = { collectionMenu.open(artist.toCollectionTarget()) },
        modifier = modifier,
    )
}
