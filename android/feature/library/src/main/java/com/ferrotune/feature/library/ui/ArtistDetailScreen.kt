package com.ferrotune.feature.library.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.LoadingState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.SongResponse

@Composable
fun ArtistDetailScreen(
    onBack: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ArtistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val albums = viewModel.albums.collectAsLazyPagingItems()
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
                        text = state.artist?.name ?: "Artist",
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
            if (state.artist != null) {
                ExtendedFloatingActionButton(
                    onClick = { viewModel.play() },
                    icon = { Icon(Icons.Filled.PlayArrow, contentDescription = null) },
                    text = { Text("Play") },
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
                message = state.error ?: "Failed to load artist",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.artist != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                val artist = state.artist!!
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CoverArt(
                        model = inlineCoverModel(artist.coverArtData)
                            ?: artist.coverArt?.let { id ->
                                state.serverUrl?.let { coverArtUrl(it, id, "medium") }
                            },
                        contentDescription = artist.name,
                        modifier = Modifier.size(140.dp),
                        shape = androidx.compose.foundation.shape.CircleShape,
                    )
                    Text(artist.name, style = MaterialTheme.typography.titleLarge)
                    Text(
                        text = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TabRow(selectedTabIndex = state.tab.ordinal) {
                    ArtistTab.entries.forEach { tab ->
                        Tab(
                            selected = tab == state.tab,
                            onClick = { viewModel.selectTab(tab) },
                            text = { Text(if (tab == ArtistTab.ALBUMS) "Albums" else "Songs") },
                        )
                    }
                }
                when (state.tab) {
                    ArtistTab.ALBUMS -> ArtistAlbumGrid(
                        items = albums,
                        onOpenAlbum = onOpenAlbum,
                    )

                    ArtistTab.SONGS -> ArtistSongList(
                        items = songs,
                        onPlaySong = { viewModel.play(it) },
                        onOpenSongRadio = onOpenSongRadio,
                    )
                }
            }
        }
    }
}

@Composable
private fun ArtistAlbumGrid(
    items: LazyPagingItems<AlbumResponse>,
    onOpenAlbum: (String) -> Unit,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load albums",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

        items.itemCount == 0 -> EmptyState("No albums for this artist")

        else -> LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val album = items[index] ?: return@items
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenAlbum(album.id) },
                ) {
                    CoverArt(
                        model = inlineCoverModel(album.coverArtData),
                        contentDescription = album.name,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(1f),
                    )
                    Text(
                        text = album.name,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    Text(
                        text = album.year?.toString().orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun ArtistSongList(
    items: LazyPagingItems<SongResponse>,
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load songs",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

        items.itemCount == 0 -> EmptyState("No songs for this artist")

        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val song = items[index] ?: return@items
                MediaRow(
                    title = song.title,
                    subtitle = listOfNotNull(song.album, song.year?.toString())
                        .joinToString(" • "),
                    coverModel = inlineCoverModel(song.coverArtData),
                    onClick = { onPlaySong(song.id) },
                    trailing = {
                        IconButton(onClick = { onOpenSongRadio(song.id) }) {
                            Icon(Icons.Filled.Radio, contentDescription = "Song radio")
                        }
                    },
                )
            }
            item {
                PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
            }
        }
    }
}
