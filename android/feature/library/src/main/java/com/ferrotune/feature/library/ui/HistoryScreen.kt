package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.feature.downloads.ui.SongDownloadAction
import com.ferrotune.feature.playlists.ui.AddToPlaylistAction
import com.ferrotune.core.network.generated.FerrotunePlayHistoryEntry
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HistoryUiState(
    val playbackError: String? = null,
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = state.asStateFlow()

    val entries: Flow<PagingData<FerrotunePlayHistoryEntry>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.history()
        }.flow.cachedIn(viewModelScope)

    fun play(songId: String) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "history",
                        sourceName = "History",
                        startSongId = songId,
                    )
                )
            } catch (e: Exception) {
                state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }
}

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

    LaunchedEffect(state.playbackError) {
        state.playbackError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissPlaybackError()
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("History") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        when {
            entries.loadState.refresh is LoadState.Error -> ErrorState(
                message = (entries.loadState.refresh as LoadState.Error).error.message
                    ?: "Failed to load history",
                onRetry = { entries.retry() },
                modifier = Modifier.padding(padding),
            )

            entries.loadState.refresh is LoadState.Loading && entries.itemCount == 0 ->
                MediaRowSkeletonList(
                    count = 10,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                )

            entries.itemCount == 0 -> EmptyState("No listening history yet")

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                items(
                    count = entries.itemCount,
                    key = entries.itemKey { "${it.playedAt}-${it.id}" },
                ) { index ->
                    val entry = entries[index] ?: return@items
                    MediaRow(
                        title = entry.title,
                        subtitle = listOfNotNull(
                            entry.artist,
                            entry.playedAt.take(10),
                        ).joinToString(" • "),
                        coverModel = inlineCoverModel(entry.coverArtData),
                        onClick = { viewModel.play(entry.id) },
                        trailing = {
                            IconButton(onClick = { onOpenSongRadio(entry.id) }) {
                                Icon(Icons.Filled.Radio, contentDescription = "Song radio")
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
