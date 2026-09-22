package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
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
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.SongActionSheet
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailBackdrop
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.downloads.ui.SongDownloadAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog
import com.ferrotune.core.network.generated.FerrotunePlayHistoryEntry
import com.ferrotune.core.network.generated.QueueSourceRequest
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

/** Web `rgba(147,51,234,0.2)` history tint. */
private val HISTORY_BACKDROP = Color(0x339333EA)

/** Web `bg-linear-to-br from-purple-500 to-purple-800`. */
private val HISTORY_ICON_GRADIENT = listOf(Color(0xFFA855F7), Color(0xFF6B21A8))

data class HistoryUiState(
    val filter: String = "",
    val songSort: SongSort = SongSort.LAST_PLAYED,
    val songSortDir: SortDir = SortDir.DESC,
    val playbackError: String? = null,
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = state.asStateFlow()

    private val filter = MutableStateFlow("")

    val entries: Flow<PagingData<FerrotunePlayHistoryEntry>> = combine(
        state.map { it.songSort }.distinctUntilChanged(),
        state.map { it.songSortDir }.distinctUntilChanged(),
        filter.debouncedFilter(),
    ) { sort, dir, filter -> Triple(sort, dir, filter) }
        .distinctUntilChanged()
        .flatMapLatest { (sort, dir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.history(
                    filter = filter.ifBlank { null },
                    sort = sort,
                    sortDir = dir,
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(key: String) {
        SongSort.entries.firstOrNull { it.apiValue == key }
            ?.let { sort -> state.update { it.copy(songSort = sort) } }
    }

    fun toggleSortDirection() {
        state.update { it.copy(songSortDir = it.songSortDir.opposite()) }
    }

    fun play(songId: String, shuffle: Boolean = false) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "history",
                        sourceName = "History",
                        sort = queueSort(
                            state.value.songSort.apiValue,
                            state.value.songSortDir.apiValue,
                        ),
                        startSongId = if (shuffle) null else songId,
                        shuffle = shuffle,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun playAll(shuffle: Boolean = false) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "history",
                        sourceName = "History",
                        sort = queueSort(
                            state.value.songSort.apiValue,
                            state.value.songSortDir.apiValue,
                        ),
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

@OptIn(kotlinx.coroutines.FlowPreview::class)
private fun Flow<String>.debouncedFilter(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged()

@Composable
fun HistoryScreen(
    onBack: () -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HistoryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val entries = viewModel.entries.collectAsLazyPagingItems()
    val snackbarHostState = remember { SnackbarHostState() }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val selection = rememberSongSelectionState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()

    LaunchedEffect(state.playbackError) {
        state.playbackError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissPlaybackError()
        }
    }

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
                            sources = listOf(
                                QueueSourceRequest(sourceType = "history", sourceId = null),
                            ),
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
                    extraActions = { ids ->
                        SongSelectionAction(Icons.Filled.PlaylistAdd, "Playlist") {
                            addToPlaylistSongIds = ids
                        }
                        SongSelectionAction(Icons.Filled.Download, "Download") {
                            downloadViewModel.downloadSongs(ids)
                            selection.clear()
                        }
                    },
                    viewModel = actionsViewModel,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            DetailBackdrop(color = HISTORY_BACKDROP, height = 300.dp)
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                DetailHeader(
                    title = "Recently Played",
                    label = "History",
                    icon = Icons.Filled.History,
                    iconGradient = HISTORY_ICON_GRADIENT,
                    subtitle = if (entries.loadState.refresh is LoadState.Loading &&
                        entries.itemCount == 0
                    ) {
                        null
                    } else {
                        val loaded = entries.itemSnapshotList.items
                        "${formatCount(loaded.size, "song")} • " +
                            formatTotalDuration(loaded.sumOf { it.duration })
                    },
                    seed = "history",
                    showBackButton = !selection.isActive,
                    onBack = onBack,
                )
                DetailActionBar(
                    onPlayAll = { viewModel.playAll() },
                    onShuffle = { viewModel.playAll(shuffle = true) },
                    playEnabled = entries.itemCount > 0,
                    actions = {
                        FilterPill(
                            value = state.filter,
                            onValueChange = viewModel::setFilter,
                            placeholder = "Filter history...",
                            modifier = Modifier.weight(1f),
                        )
                        SortMenu(
                            options = SONG_SORT_OPTIONS,
                            selectedKey = state.songSort.apiValue,
                            ascending = state.songSortDir == SortDir.ASC,
                            onSelect = viewModel::selectSort,
                            onToggleDirection = viewModel::toggleSortDirection,
                        )
                    },
                )
                when {
                    entries.loadState.refresh is LoadState.Error -> ErrorState(
                        message = (entries.loadState.refresh as LoadState.Error).error.message
                            ?: "Failed to load history",
                        onRetry = { entries.retry() },
                    )

                    entries.loadState.refresh is LoadState.Loading && entries.itemCount == 0 ->
                        MediaRowSkeletonList(
                            count = 10,
                            modifier = Modifier.fillMaxSize(),
                        )

                    entries.itemCount == 0 -> EmptyState("No listening history yet")

                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(
                            count = entries.itemCount,
                            key = entries.itemKey { "${it.playedAt}-${it.id}" },
                        ) { index ->
                            val entry = entries[index] ?: return@items
                            val flags = rememberSongFlags(
                                songId = entry.id,
                                starred = entry.starred != null,
                            )
                            var menuExpanded by remember { mutableStateOf(false) }
                            MediaRow(
                                title = entry.title,
                                subtitle = listOfNotNull(
                                    entry.artist,
                                    entry.playedAt.take(10),
                                ).joinToString(" • "),
                                coverModel = inlineCoverModel(entry.coverArtData),
                                coverSeed = entry.id,
                                onClick = { viewModel.play(entry.id) },
                                isSelectionActive = selection.isActive,
                                isSelected = entry.id in selection.selectedIds,
                                onToggleSelection = { selection.toggle(entry.id) },
                                onLongClick = {
                                    if (selection.isActive) {
                                        selection.toggle(entry.id)
                                    } else {
                                        menuExpanded = true
                                    }
                                },
                                trailing = {
                                    Box {
                                        SongFavoriteButton(songId = entry.id, flags = flags)
                                        SongActionSheet(
                                            expanded = menuExpanded,
                                            onDismiss = { menuExpanded = false },
                                            songId = entry.id,
                                            flags = flags,
                                            title = entry.title,
                                            subtitle = entry.artist,
                                            coverModel = inlineCoverModel(entry.coverArtData),
                                            onOpenSongRadio = { onOpenSongRadio(entry.id) },
                                            onStartSelection = { selection.select(entry.id) },
                                        )
                                    }
                                    AddToPlaylistAction(songIds = listOf(entry.id))
                                    SongDownloadAction(songId = entry.id)
                                },
                            )
                        }
                        item {
                            PagingListFooter(isLoading = entries.loadState.append is LoadState.Loading)
                        }
                    }
                }
            }
        }
    }

    addToPlaylistSongIds?.let { songIds ->
        AddToPlaylistDialog(
            songIds = songIds,
            onDismiss = { addToPlaylistSongIds = null },
            onAdded = {
                addToPlaylistSongIds = null
                selection.clear()
            },
        )
    }
}
