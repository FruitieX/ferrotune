package com.ferrotune.feature.library.ui

import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.waitFor
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.paging.LoadState
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.map
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.media.queueTextFilter
import com.ferrotune.core.network.ViewSortConfig
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.network.generated.FerrotunePlayHistoryEntry
import com.ferrotune.core.network.generated.QueueSourceRequest
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
import kotlinx.coroutines.withTimeoutOrNull

/** Web `rgba(147,51,234,0.2)` history tint. */
private val HISTORY_BACKDROP = Color(0x339333EA)

/** Web `bg-linear-to-br from-purple-500 to-purple-800`. */
private val HISTORY_ICON_GRADIENT = listOf(Color(0xFFA855F7), Color(0xFF6B21A8))

data class HistoryUiState(
    val filter: String = "",
    val songSort: SongSort = SongSort.LAST_PLAYED,
    val songSortDir: SortDir = SortDir.DESC,
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewSortPreferences: ViewSortPreferencesRepository,
    private val messages: UserMessages,
) : ViewModel() {

    private val state = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")
    private val sortReady = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { viewSortPreferences.ensureLoaded() }
            val stored = viewSortPreferences.config(
                ViewSortKey.HISTORY,
                ViewSortConfig(SongSort.LAST_PLAYED.apiValue, SortDir.DESC.apiValue),
            )
            state.update {
                it.copy(
                    songSort = SongSort.fromApiValue(stored.field) ?: SongSort.LAST_PLAYED,
                    songSortDir = SortDir.fromApiValue(stored.direction) ?: SortDir.DESC,
                )
            }
            sortReady.value = true
        }
    }

    /** History rows as songs, so the list shares the app-wide song row. */
    val entries: Flow<PagingData<SongResponse>> = combine(
        state.map { it.songSort }.distinctUntilChanged(),
        state.map { it.songSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.history(filter = filter.ifBlank { null }, sort = sort, sortDir = dir)
            }.flow
        }
        .map { page -> page.map { it.toSong() } }
        .cachedIn(viewModelScope)

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(key: String) {
        val sort = SongSort.fromApiValue(key) ?: return
        state.update { it.copy(songSort = sort) }
        persistSort()
    }

    fun toggleSortDirection() {
        state.update { it.copy(songSortDir = it.songSortDir.opposite()) }
        persistSort()
    }

    private fun persistSort() {
        val current = state.value
        viewModelScope.launch {
            viewSortPreferences.setSort(ViewSortKey.HISTORY, current.songSort.apiValue, current.songSortDir.apiValue)
        }
    }

    /** Plays history exactly as listed, optionally from one entry. */
    fun play(startSongId: String? = null, startIndex: Int = 0, shuffle: Boolean = false) {
        val current = state.value
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "history",
                        sourceName = "History",
                        filters = queueTextFilter(current.filter),
                        sort = queueSort(current.songSort.apiValue, current.songSortDir.apiValue),
                        startSongId = startSongId,
                        startIndex = startIndex,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }
}

@OptIn(kotlinx.coroutines.FlowPreview::class)
private fun Flow<String>.debouncedFilter(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged()

private fun FerrotunePlayHistoryEntry.toSong() = SongResponse(
    id = id,
    parent = parent,
    title = title,
    album = album,
    albumId = albumId,
    artist = artist,
    artistId = artistId,
    track = track,
    discNumber = discNumber,
    year = year,
    genre = genre,
    coverArt = coverArt,
    coverArtData = coverArtData,
    coverArtWidth = coverArtWidth,
    coverArtHeight = coverArtHeight,
    size = size,
    contentType = contentType,
    suffix = suffix,
    duration = duration,
    bitRate = bitRate,
    path = path,
    fullPath = fullPath,
    starred = starred,
    userRating = userRating,
    created = created,
    type = type,
    playCount = playCount,
    lastPlayed = lastPlayed ?: playedAt,
    playStarts = playStarts,
)

/** Web "Recently Played" page: purple history header, actions, and the list. */
@Composable
fun HistoryScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HistoryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val entries = viewModel.entries.collectAsLazyPagingItems()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val nowPlaying = rememberNowPlaying()
    var sortMenuOpen by remember { mutableStateOf(false) }

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
                            sources = listOf(QueueSourceRequest(sourceType = "history", sourceId = null)),
                            onLoaded = selection::replace,
                        )
                    },
                    selectingAll = selectingAll,
                )
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
        val actionBar: @Composable () -> Unit = {
            DetailActionBar(
                onPlayAll = { viewModel.play() },
                onShuffle = { viewModel.play(shuffle = true) },
                playEnabled = entries.itemCount > 0,
                actions = {
                    FilterPill(
                        value = state.filter,
                        onValueChange = viewModel::setFilter,
                        placeholder = "Filter history...",
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { sortMenuOpen = true }) {
                        Icon(Icons.Filled.MoreHoriz, contentDescription = "Sort options")
                    }
                },
            )
        }
        val listState = rememberLazyListState()
        val actionBarPinned by rememberActionBarPinned(listState)
        Box(modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                item(key = "hero") {
                    DetailHero(backdropColor = HISTORY_BACKDROP) {
                        DetailHeader(
                            title = "Recently Played",
                            label = "History",
                            icon = Icons.Filled.History,
                            iconGradient = HISTORY_ICON_GRADIENT,
                            meta = if (entries.loadState.refresh is LoadState.Loading && entries.itemCount == 0) {
                                null
                            } else {
                                val loaded = entries.itemSnapshotList.items
                                "${formatCount(loaded.size, "song")} • ${formatTotalDuration(loaded.sumOf { it.duration })}"
                            },
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                item(key = "columns") { TrackListHeader() }
                songPagingItems(
                    songs = entries,
                    nowPlaying = nowPlaying,
                    menu = songMenu,
                    selection = selection,
                    onPlay = { song, position -> viewModel.play(song.id, position) },
                    emptyMessage = if (state.filter.isBlank()) "No listening history yet" else "No songs match your filter",
                    emptyIcon = Icons.Filled.History,
                    // The same song can appear more than once; keys fall back to positions.
                    key = null,
                )
            }
            PinnedActionBar(visible = actionBarPinned) { actionBar() }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { viewModel.play(it.id) },
        onStartSelection = { selection.select(it.id) },
    )
    if (sortMenuOpen) {
        MediaActionSheet(
            expanded = true,
            onDismiss = { sortMenuOpen = false },
            actions = emptyList(),
            extraContent = {
                SortSheetSection(
                    options = SONG_SORT_OPTIONS,
                    selectedKey = state.songSort.apiValue,
                    ascending = state.songSortDir == SortDir.ASC,
                    onSelect = viewModel::selectSort,
                    onToggleDirection = viewModel::toggleSortDirection,
                )
            },
        )
    }
}
