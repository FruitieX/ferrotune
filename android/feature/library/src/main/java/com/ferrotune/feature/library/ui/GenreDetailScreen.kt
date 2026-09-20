package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.ExtendedFloatingActionButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.feature.playlists.ui.AddToPlaylistAction
import com.ferrotune.core.designsystem.components.PagingListFooter

@Composable
fun GenreDetailScreen(
    onBack: () -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: GenreDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
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
                title = {
                    Text(
                        text = viewModel.genre,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { viewModel.play() },
                icon = { Icon(Icons.Filled.PlayArrow, contentDescription = null) },
                text = { Text("Play") },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                songs.loadState.refresh is LoadState.Error -> ErrorState(
                    message = (songs.loadState.refresh as LoadState.Error).error.message
                        ?: "Failed to load songs",
                    onRetry = { songs.retry() },
                )

                songs.loadState.refresh is LoadState.Loading && songs.itemCount == 0 ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        androidx.compose.material3.CircularProgressIndicator()
                    }

                songs.itemCount == 0 -> EmptyState("No songs in this genre")

                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(
                        count = songs.itemCount,
                        key = songs.itemKey { it.id },
                    ) { index ->
                        val song = songs[index] ?: return@items
                        MediaRow(
                            title = song.title,
                            subtitle = listOfNotNull(song.artist, song.album)
                                .joinToString(" • "),
                            coverModel = inlineCoverModel(song.coverArtData),
                            onClick = { viewModel.play(song.id) },
                            trailing = {
                                IconButton(onClick = { onOpenSongRadio(song.id) }) {
                                    Icon(Icons.Filled.Radio, contentDescription = "Song radio")
                                }
                                    AddToPlaylistAction(songIds = listOf(song.id))
                            },
                        )
                    }
                    item {
                        PagingListFooter(isLoading = songs.loadState.append is LoadState.Loading)
                    }
                }
            }
        }
    }
}
