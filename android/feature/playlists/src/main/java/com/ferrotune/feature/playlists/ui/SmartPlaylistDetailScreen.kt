package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.SmartPlaylistInfo

@Composable
fun SmartPlaylistDetailScreen(
    onBack: () -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onEditRules: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SmartPlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    var menuExpanded by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onBack()
    }
    LaunchedEffect(state.materializedPlaylistId) {
        state.materializedPlaylistId?.let(onOpenPlaylist)
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(state.smartPlaylist?.name ?: "Smart playlist") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(
                            expanded = menuExpanded,
                            onDismissRequest = { menuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Shuffle") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.play(shuffle = true)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Edit rules") },
                                onClick = {
                                    menuExpanded = false
                                    onEditRules()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Create playlist from this") },
                                onClick = {
                                    menuExpanded = false
                                    viewModel.materialize()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Delete smart playlist") },
                                onClick = {
                                    menuExpanded = false
                                    showDeleteDialog = true
                                },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (state.smartPlaylist != null) {
                ExtendedFloatingActionButton(
                    onClick = { viewModel.play() },
                    icon = { Icon(Icons.Filled.PlayArrow, contentDescription = null) },
                    text = { Text("Play") },
                )
            }
        },
    ) { padding ->
        when {
            state.loading && state.smartPlaylist == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            state.error != null && state.smartPlaylist == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                ErrorState(message = state.error!!, onRetry = viewModel::load)
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                state.smartPlaylist?.let { smartPlaylist ->
                    item {
                        SmartPlaylistHeader(
                            smartPlaylist = smartPlaylist,
                            serverUrl = state.serverUrl,
                        )
                    }
                }
                when {
                    songs.loadState.refresh is LoadState.Error -> item {
                        ErrorState(
                            message = (songs.loadState.refresh as LoadState.Error).error.message
                                ?: "Failed to load songs",
                            onRetry = { songs.retry() },
                        )
                    }

                    songs.itemCount == 0 && songs.loadState.refresh !is LoadState.Loading -> item {
                        EmptyState("No songs match these rules")
                    }

                    else -> items(
                        count = songs.itemCount,
                        key = songs.itemKey { it.id },
                    ) { index ->
                        val song = songs[index] ?: return@items
                        MediaRow(
                            title = song.title,
                            subtitle = listOfNotNull(song.artist, song.album)
                                .joinToString(" • "),
                            coverModel = inlineCoverModel(song.coverArtData),
                            onClick = { viewModel.play(startSongId = song.id) },
                            trailing = {
                                IconButton(onClick = { onOpenSongRadio(song.id) }) {
                                    Icon(
                                        Icons.Filled.Radio,
                                        contentDescription = "Song radio",
                                    )
                                }
                            },
                        )
                    }
                }
                item {
                    PagingListFooter(isLoading = songs.loadState.append is LoadState.Loading)
                }
            }
        }
    }

    state.playbackError?.let { message ->
        ConfirmDialog(
            title = "Playback failed",
            message = message,
            confirmLabel = "OK",
            onDismiss = viewModel::dismissPlaybackError,
            onConfirm = viewModel::dismissPlaybackError,
        )
    }

    if (showDeleteDialog) {
        ConfirmDialog(
            title = "Delete smart playlist",
            message = "Delete \"${state.smartPlaylist?.name ?: ""}\"?",
            onDismiss = { showDeleteDialog = false },
            onConfirm = {
                showDeleteDialog = false
                viewModel.deleteSmartPlaylist()
            },
        )
    }
}

@Composable
private fun SmartPlaylistHeader(
    smartPlaylist: SmartPlaylistInfo,
    serverUrl: String?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverArt(
            model = serverUrl?.let {
                coverArtUrl(serverUrl = it, coverArtId = "sp-${smartPlaylist.id}", size = "medium")
            },
            contentDescription = smartPlaylist.name,
            modifier = Modifier.size(96.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = smartPlaylist.name,
                style = MaterialTheme.typography.titleLarge,
            )
            if (!smartPlaylist.comment.isNullOrBlank()) {
                Text(
                    text = smartPlaylist.comment.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = buildString {
                    append("Smart playlist")
                    smartPlaylist.songCount?.let { append(" • $it songs") }
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "${smartPlaylist.rules.conditions.size} rules • " +
                    smartPlaylist.rules.logic.uppercase(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
