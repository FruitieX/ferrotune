package com.ferrotune.feature.library.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
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
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.SortMenu
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.SongSort

private val SONG_SORT_OPTIONS = listOf(
    SortOption(SongSort.TITLE.apiValue, "Title"),
    SortOption(SongSort.ARTIST.apiValue, "Artist"),
    SortOption(SongSort.ALBUM.apiValue, "Album"),
    SortOption(SongSort.YEAR.apiValue, "Year"),
    SortOption(SongSort.DURATION.apiValue, "Duration"),
    SortOption(SongSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(SongSort.PLAY_COUNT.apiValue, "Play count"),
    SortOption(SongSort.LAST_PLAYED.apiValue, "Last played"),
)

private val ALBUM_SORT_OPTIONS = listOf(
    SortOption(AlbumSort.NAME.apiValue, "Name"),
    SortOption(AlbumSort.ARTIST.apiValue, "Artist"),
    SortOption(AlbumSort.YEAR.apiValue, "Year"),
    SortOption(AlbumSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(AlbumSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(AlbumSort.LAST_PLAYED.apiValue, "Last played"),
)

private val ARTIST_SORT_OPTIONS = listOf(
    SortOption(ArtistSort.NAME.apiValue, "Name"),
    SortOption(ArtistSort.ALBUM_COUNT.apiValue, "Album count"),
    SortOption(ArtistSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(ArtistSort.LAST_PLAYED.apiValue, "Last played"),
)

@Composable
fun LibraryScreen(
    onOpenArtist: (String) -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenGenre: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    onOpenFavorites: () -> Unit,
    onOpenHistory: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
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
                title = { Text("Library") },
                actions = {
                    IconButton(onClick = onOpenFavorites) {
                        Icon(Icons.Filled.FavoriteBorder, contentDescription = "Favorites")
                    }
                    IconButton(onClick = onOpenHistory) {
                        Icon(Icons.Filled.History, contentDescription = "History")
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
            ScrollableTabRow(selectedTabIndex = state.tab.ordinal, edgePadding = 8.dp) {
                LibraryTab.entries.forEach { tab ->
                    Tab(
                        selected = tab == state.tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = { Text(tab.label()) },
                    )
                }
            }
            when (state.tab) {
                LibraryTab.SONGS -> SongsTab(
                    sortKey = state.songSort.apiValue,
                    ascending = state.songSortDir.isAscending(),
                    onSelectSort = { key ->
                        SongSort.entries.firstOrNull { it.apiValue == key }
                            ?.let(viewModel::selectSongSort)
                    },
                    onToggleDirection = viewModel::toggleSongSortDir,
                    onPlaySong = viewModel::playSong,
                    onOpenSongRadio = onOpenSongRadio,
                    items = viewModel.songs.collectAsLazyPagingItems(),
                )

                LibraryTab.ALBUMS -> AlbumsTab(
                    sortKey = state.albumSort.apiValue,
                    ascending = state.albumSortDir.isAscending(),
                    onSelectSort = { key ->
                        AlbumSort.entries.firstOrNull { it.apiValue == key }
                            ?.let(viewModel::selectAlbumSort)
                    },
                    onToggleDirection = viewModel::toggleAlbumSortDir,
                    onOpenAlbum = onOpenAlbum,
                    items = viewModel.albums.collectAsLazyPagingItems(),
                )

                LibraryTab.ARTISTS -> ArtistsTab(
                    sortKey = state.artistSort.apiValue,
                    ascending = state.artistSortDir.isAscending(),
                    onSelectSort = { key ->
                        ArtistSort.entries.firstOrNull { it.apiValue == key }
                            ?.let(viewModel::selectArtistSort)
                    },
                    onToggleDirection = viewModel::toggleArtistSortDir,
                    onOpenArtist = onOpenArtist,
                    items = viewModel.artists.collectAsLazyPagingItems(),
                )

                LibraryTab.GENRES -> GenresTab(
                    genres = state.genres,
                    loading = state.genresLoading,
                    error = state.genresError,
                    onRetry = viewModel::loadGenres,
                    onOpenGenre = onOpenGenre,
                )
            }
        }
    }
}

private fun LibraryTab.label(): String = when (this) {
    LibraryTab.ARTISTS -> "Artists"
    LibraryTab.ALBUMS -> "Albums"
    LibraryTab.SONGS -> "Songs"
    LibraryTab.GENRES -> "Genres"
}

private fun com.ferrotune.feature.library.data.SortDir.isAscending(): Boolean =
    this == com.ferrotune.feature.library.data.SortDir.ASC

@Composable
private fun SongsTab(
    sortKey: String,
    ascending: Boolean,
    onSelectSort: (String) -> Unit,
    onToggleDirection: () -> Unit,
    onPlaySong: (String) -> Unit,
    onOpenSongRadio: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<SongResponse>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SortMenu(
                options = SONG_SORT_OPTIONS,
                selectedKey = sortKey,
                ascending = ascending,
                onSelect = onSelectSort,
                onToggleDirection = onToggleDirection,
            )
        }
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load songs",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
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
                    PagingListFooter(
                        isLoading = items.loadState.append is androidx.paging.LoadState.Loading,
                    )
                }
            }
        }
    }
}

@Composable
private fun AlbumsTab(
    sortKey: String,
    ascending: Boolean,
    onSelectSort: (String) -> Unit,
    onToggleDirection: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<AlbumResponse>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SortMenu(
                options = ALBUM_SORT_OPTIONS,
                selectedKey = sortKey,
                ascending = ascending,
                onSelect = onSelectSort,
                onToggleDirection = onToggleDirection,
            )
        }
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load albums",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
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
                        modifier = Modifier.fillMaxWidth(),
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
}

@Composable
private fun ArtistsTab(
    sortKey: String,
    ascending: Boolean,
    onSelectSort: (String) -> Unit,
    onToggleDirection: () -> Unit,
    onOpenArtist: (String) -> Unit,
    items: androidx.paging.compose.LazyPagingItems<ArtistResponse>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SortMenu(
                options = ARTIST_SORT_OPTIONS,
                selectedKey = sortKey,
                ascending = ascending,
                onSelect = onSelectSort,
                onToggleDirection = onToggleDirection,
            )
        }
        when {
            items.loadState.refresh is androidx.paging.LoadState.Error ->
                ErrorState(
                    message = (items.loadState.refresh as androidx.paging.LoadState.Error).error.message
                        ?: "Failed to load artists",
                    onRetry = { items.retry() },
                )

            items.loadState.refresh is androidx.paging.LoadState.Loading && items.itemCount == 0 ->
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
                        subtitle = artistCounts(artist),
                        coverModel = inlineCoverModel(artist.coverArtData),
                        onClick = { onOpenArtist(artist.id) },
                    )
                }
                item {
                    PagingListFooter(
                        isLoading = items.loadState.append is androidx.paging.LoadState.Loading,
                    )
                }
            }
        }
    }
}

private fun artistCounts(artist: ArtistResponse): String {
    val albums = artist.albumCount ?: 0
    val songs = artist.songCount ?: 0
    return "$albums albums • $songs songs"
}

@Composable
private fun GenresTab(
    genres: List<GenreResponse>,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    onOpenGenre: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        error != null -> ErrorState(message = error, onRetry = onRetry, modifier = modifier)
        loading && genres.isEmpty() -> LoadingBox(modifier)
        genres.isEmpty() -> EmptyState("No genres found", modifier)
        else -> LazyColumn(modifier = modifier.fillMaxSize()) {
            items(genres, key = { it.value }) { genre ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenGenre(genre.value) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(genre.value, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            text = "${genre.songCount} songs • ${genre.albumCount} albums",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
