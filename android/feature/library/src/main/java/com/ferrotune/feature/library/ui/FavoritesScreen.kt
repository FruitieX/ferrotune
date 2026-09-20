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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.paging.LoadState
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.SongResponse
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

enum class FavoritesTab {
    SONGS,
    ALBUMS,
    ARTISTS,
}

data class FavoritesUiState(
    val tab: FavoritesTab = FavoritesTab.SONGS,
    val playbackError: String? = null,
)

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = state.asStateFlow()

    val songs: Flow<PagingData<SongResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.songs(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    val albums: Flow<PagingData<AlbumResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.albums(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    val artists: Flow<PagingData<ArtistResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artists(starredOnly = true)
        }.flow.cachedIn(viewModelScope)

    fun selectTab(tab: FavoritesTab) = state.update { it.copy(tab = tab) }

    fun playSong(songId: String) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "favorites",
                        sourceName = "Favorites",
                        sort = queueSort("name", "asc"),
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
fun FavoritesScreen(
    onBack: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
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
                title = { Text("Favorites") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            TabRow(selectedTabIndex = state.tab.ordinal) {
                FavoritesTab.entries.forEach { tab ->
                    Tab(
                        selected = tab == state.tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = { Text(tab.label()) },
                    )
                }
            }
            when (state.tab) {
                FavoritesTab.SONGS -> PagedSongList(
                    items = viewModel.songs.collectAsLazyPagingItems(),
                    onPlaySong = viewModel::playSong,
                    onOpenSongRadio = onOpenSongRadio,
                )

                FavoritesTab.ALBUMS -> PagedAlbumGrid(
                    items = viewModel.albums.collectAsLazyPagingItems(),
                    onOpenAlbum = onOpenAlbum,
                )

                FavoritesTab.ARTISTS -> PagedArtistList(
                    items = viewModel.artists.collectAsLazyPagingItems(),
                    onOpenArtist = onOpenArtist,
                )
            }
        }
    }
}

private fun FavoritesTab.label(): String = when (this) {
    FavoritesTab.SONGS -> "Songs"
    FavoritesTab.ALBUMS -> "Albums"
    FavoritesTab.ARTISTS -> "Artists"
}

@Composable
internal fun PagedSongList(
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

        items.itemCount == 0 -> EmptyState("No songs found")

        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val song = items[index] ?: return@items
                MediaRow(
                    title = song.title,
                    subtitle = listOfNotNull(song.artist, song.album).joinToString(" • "),
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

@Composable
internal fun PagedAlbumGrid(
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

        items.itemCount == 0 -> EmptyState("No albums found")

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
                        text = album.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
internal fun PagedArtistList(
    items: LazyPagingItems<ArtistResponse>,
    onOpenArtist: (String) -> Unit,
) {
    when {
        items.loadState.refresh is LoadState.Error -> ErrorState(
            message = (items.loadState.refresh as LoadState.Error).error.message
                ?: "Failed to load artists",
            onRetry = { items.retry() },
        )

        items.loadState.refresh is LoadState.Loading && items.itemCount == 0 ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

        items.itemCount == 0 -> EmptyState("No artists found")

        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(
                count = items.itemCount,
                key = items.itemKey { it.id },
            ) { index ->
                val artist = items[index] ?: return@items
                MediaRow(
                    title = artist.name,
                    subtitle = "${artist.albumCount ?: 0} albums • ${artist.songCount ?: 0} songs",
                    coverModel = inlineCoverModel(artist.coverArtData),
                    onClick = { onOpenArtist(artist.id) },
                )
            }
            item {
                PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
            }
        }
    }
}
