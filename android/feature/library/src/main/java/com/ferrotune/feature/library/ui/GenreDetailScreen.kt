package com.ferrotune.feature.library.ui

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
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.theme.genreGradientColors
import com.ferrotune.core.designsystem.theme.seedBackdropColor
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.library.data.SortDir

/** Web genre page: tag-tile header, play/shuffle/filter/⋯, and the song list. */
@Composable
fun GenreDetailScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: GenreDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val genreMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    val genre = viewModel.genre

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = {
                        actionsViewModel.loadAllIds(
                            sources = listOf(QueueSourceRequest(sourceType = "genre", sourceId = genre)),
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
                playEnabled = songs.itemCount > 0,
                actions = {
                    FilterPill(
                        value = state.filter,
                        onValueChange = viewModel::setFilter,
                        placeholder = "Filter songs...",
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            genreMenu.open(
                                CollectionTarget(
                                    sourceType = CollectionSource.GENRE,
                                    sourceId = genre,
                                    name = genre,
                                    subtitle = "Genre",
                                ),
                            )
                        },
                    ) {
                        Icon(Icons.Filled.MoreHoriz, contentDescription = "More options")
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
                    DetailHero(backdropColor = seedBackdropColor(genre)) {
                        DetailHeader(
                            title = genre,
                            label = "Genre",
                            meta = "${formatCount(state.albumCount.toInt(), "album")} • " +
                                formatCount(state.songCount.toInt(), "song"),
                            icon = Icons.Filled.Tag,
                            iconGradient = genreGradientColors(genre),
                            seed = genre,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                item(key = "columns") { TrackListHeader() }
                songPagingItems(
                    songs = songs,
                    nowPlaying = nowPlaying,
                    menu = songMenu,
                    selection = selection,
                    onPlay = { song, position -> viewModel.play(song.id, position) },
                    emptyMessage = if (state.filter.isBlank()) "No songs in this genre" else "No songs match your filter",
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
    CollectionMenuSheet(
        state = genreMenu,
        extraContent = {
            SortSheetSection(
                options = DETAIL_SONG_SORT_OPTIONS,
                selectedKey = state.sort,
                ascending = state.sortDir == SortDir.ASC,
                onSelect = viewModel::selectSort,
                onToggleDirection = viewModel::toggleSortDir,
            )
        },
    )
}
