package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongSelectionAction
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.LoadingState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.SectionHeader
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.DownloadActionViewModel
import com.ferrotune.feature.playlists.ui.AddToPlaylistDialog

@Composable
fun SongRadioScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SongRadioViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var addToPlaylistSongIds by remember { mutableStateOf<List<String>?>(null) }
    val selection = rememberSongSelectionState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val downloadViewModel: DownloadActionViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val radioSource = state.seed?.let {
        listOf(QueueSourceRequest(sourceType = "songRadio", sourceId = it.id))
    }

    LaunchedEffect(state.playbackError) {
        state.playbackError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissPlaybackError()
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = radioSource?.let { sources ->
                        {
                            actionsViewModel.loadAllIds(
                                sources = sources,
                                onLoaded = selection::replace,
                            )
                        }
                    },
                    selectingAll = selectingAll,
                )
            } else {
                TopAppBar(
                    title = { Text("Song Radio") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
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
        when {
            state.loading -> LoadingState(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.error != null -> ErrorState(
                message = state.error ?: "Failed to load radio",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.seed != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                val seed = state.seed!!
                DetailHeader(
                    title = "Song Radio",
                    subtitle = seed.title,
                    seed = seed.id,
                    coverSize = 120.dp,
                    coverModel = inlineCoverModel(seed.coverArtData),
                    badges = {
                        Text(
                            text = seed.artist,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    actions = {
                        Button(onClick = { viewModel.play() }) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Play radio")
                        }
                    },
                )
                SectionHeader(title = "Similar songs")
                if (state.similar.isEmpty()) {
                    EmptyState("No similar songs available")
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(state.similar, key = { it.id }) { song ->
                            MediaRow(
                                title = song.title,
                                subtitle = listOfNotNull(song.artist, song.album)
                                    .joinToString(" • "),
                                coverModel = inlineCoverModel(song.coverArtData),
                                onClick = { viewModel.play(song.id) },
                                isSelectionActive = selection.isActive,
                                isSelected = song.id in selection.selectedIds,
                                onToggleSelection = { selection.toggle(song.id) },
                                onLongClick = { selection.select(song.id) },
                            )
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
