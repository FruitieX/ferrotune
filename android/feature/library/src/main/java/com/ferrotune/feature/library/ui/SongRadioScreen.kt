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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongListRow
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.theme.seedBackdropColor

/** Web Song Radio page: the seed song header and the similar-songs queue. */
@Composable
fun SongRadioScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SongRadioViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val nowPlaying = rememberNowPlaying()
    val seed = state.seed

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = { selection.replace(state.similar.map { it.id }) },
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
                playEnabled = state.similar.isNotEmpty(),
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
                    DetailHero(backdropColor = seedBackdropColor(seed?.title.orEmpty())) {
                        DetailHeader(
                            title = seed?.let { "${it.title} Radio" }.orEmpty(),
                            label = "Radio",
                            subtitle = seed?.let { "Based on ${it.title} by ${it.artist}" },
                            meta = state.similar.takeIf { it.isNotEmpty() }?.let { similar ->
                                "${formatCount(similar.size, "song")} • ${formatTotalDuration(similar.sumOf { it.duration })}"
                            },
                            seed = seed?.album ?: seed?.title,
                            coverModel = inlineCoverModel(seed?.coverArtData),
                            coverPlaceholder = Icons.Filled.Radio,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                when {
                    state.loading -> item(key = "loading") { MediaRowSkeletonList(count = 8) }
                    state.error != null -> item(key = "error") { ErrorState(message = state.error!!) }
                    state.similar.isEmpty() -> item(key = "empty") {
                        EmptyState("No similar songs available", icon = Icons.Filled.Radio)
                    }

                    else -> {
                        item(key = "columns") { TrackListHeader() }
                        itemsIndexed(state.similar, key = { _, song -> song.id }) { index, song ->
                            SongListRow(
                                song = song,
                                nowPlaying = nowPlaying,
                                menu = songMenu,
                                selection = selection,
                                index = index + 1,
                                onPlay = { viewModel.play(song.id, index) },
                            )
                        }
                    }
                }
            }
            PinnedActionBar(visible = actionBarPinned) { actionBar() }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { viewModel.play(it.id) },
        onStartSelection = { selection.select(it.id) },
    )
}
