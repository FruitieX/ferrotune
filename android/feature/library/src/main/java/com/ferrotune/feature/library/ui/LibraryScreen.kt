package com.ferrotune.feature.library.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionMenuState
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.ChipTab
import com.ferrotune.core.designsystem.components.ChipTabRow
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.MediaGridMinCellWidth
import com.ferrotune.core.designsystem.components.PageTitle
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.SortOption
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.theme.genreGradientColors
import com.ferrotune.core.network.MATCH_ALL_SONGS_QUERY
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.readableMessage
import com.ferrotune.feature.library.data.AlbumSort
import com.ferrotune.feature.library.data.ArtistSort
import com.ferrotune.feature.library.data.SongSort

internal const val CUSTOM_SORT = "custom"

internal val SONG_SORT_OPTIONS = listOf(
    SortOption(SongSort.TITLE.apiValue, "Title"),
    SortOption(SongSort.ARTIST.apiValue, "Artist"),
    SortOption(SongSort.ALBUM.apiValue, "Album"),
    SortOption(SongSort.YEAR.apiValue, "Year"),
    SortOption(SongSort.DURATION.apiValue, "Duration"),
    SortOption(SongSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(SongSort.PLAY_COUNT.apiValue, "Play count"),
    SortOption(SongSort.LAST_PLAYED.apiValue, "Last played"),
)

internal val DETAIL_SONG_SORT_OPTIONS = listOf(
    SortOption(CUSTOM_SORT, "Custom order"),
    SortOption(SongSort.TITLE.apiValue, "Title"),
    SortOption(SongSort.ARTIST.apiValue, "Artist"),
    SortOption(SongSort.ALBUM.apiValue, "Album"),
    SortOption(SongSort.YEAR.apiValue, "Year"),
    SortOption(SongSort.DURATION.apiValue, "Duration"),
    SortOption(SongSort.DATE_ADDED.apiValue, "Date added"),
)

internal val ALBUM_SORT_OPTIONS = listOf(
    SortOption(AlbumSort.NAME.apiValue, "Name"),
    SortOption(AlbumSort.ARTIST.apiValue, "Artist"),
    SortOption(AlbumSort.YEAR.apiValue, "Year"),
    SortOption(AlbumSort.DATE_ADDED.apiValue, "Date added"),
    SortOption(AlbumSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(AlbumSort.LAST_PLAYED.apiValue, "Last played"),
)

internal val ARTIST_SORT_OPTIONS = listOf(
    SortOption(ArtistSort.NAME.apiValue, "Name"),
    SortOption(ArtistSort.ALBUM_COUNT.apiValue, "Album count"),
    SortOption(ArtistSort.SONG_COUNT.apiValue, "Song count"),
    SortOption(ArtistSort.LAST_PLAYED.apiValue, "Last played"),
)

private val LIBRARY_TABS = listOf(
    ChipTab("Albums", Icons.Filled.Album),
    ChipTab("Artists", Icons.Filled.Person),
    ChipTab("Songs", Icons.Filled.MusicNote),
    ChipTab("Genres", Icons.Filled.Label),
)

/**
 * The web Library page: title, filter, and ⋯ (sort) in the top row, chip tabs
 * below, then a three-column album/artist/genre grid or the song list. Each
 * tab keeps its own scroll position while switching.
 */
@Composable
fun LibraryScreen(
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()

    // Hoisted per tab so switching tabs keeps each tab's scroll position.
    val albumsGrid = rememberLazyGridState()
    val artistsGrid = rememberLazyGridState()
    val genresGrid = rememberLazyGridState()
    val songsList = rememberLazyListState()

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
                            searchParams = SearchParams(
                                query = state.filter.trim().ifEmpty { MATCH_ALL_SONGS_QUERY },
                                songSort = state.songSort.apiValue,
                                songSortDir = state.songSortDir.apiValue,
                            ),
                            onLoaded = selection::replace,
                        )
                    },
                    selectingAll = selectingAll,
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.background)
                        .statusBarsPadding(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PageTitle("Library")
                        FilterPill(
                            value = state.filter,
                            onValueChange = viewModel::setFilter,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(
                            onClick = { menuOpen = true },
                            enabled = state.tab != LibraryTab.GENRES,
                        ) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "Sort options")
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    ChipTabRow(
                        tabs = LIBRARY_TABS,
                        selectedIndex = state.tab.ordinal,
                        onSelect = { index ->
                            selection.clear()
                            viewModel.selectTab(LibraryTab.entries[index])
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (state.tab) {
                LibraryTab.ALBUMS -> AlbumsGrid(
                    items = viewModel.albums.collectAsLazyPagingItems(),
                    gridState = albumsGrid,
                    collectionMenu = collectionMenu,
                )

                LibraryTab.ARTISTS -> ArtistsGrid(
                    items = viewModel.artists.collectAsLazyPagingItems(),
                    gridState = artistsGrid,
                    collectionMenu = collectionMenu,
                )

                LibraryTab.SONGS -> {
                    val songs = viewModel.songs.collectAsLazyPagingItems()
                    val nowPlaying = rememberNowPlaying()
                    LazyColumn(state = songsList, modifier = Modifier.fillMaxSize()) {
                        songPagingItems(
                            songs = songs,
                            nowPlaying = nowPlaying,
                            menu = songMenu,
                            selection = selection,
                            onPlay = { song, position -> viewModel.playSong(song.id, position) },
                            emptyMessage = if (state.filter.isBlank()) "No songs found" else "No songs match your filter",
                            index = null,
                        )
                    }
                }

                LibraryTab.GENRES -> GenresGrid(
                    genres = state.genres.filter {
                        state.filter.isBlank() || it.value.contains(state.filter.trim(), ignoreCase = true)
                    },
                    loading = state.genresLoading,
                    error = state.genresError,
                    gridState = genresGrid,
                    onRetry = viewModel::loadGenres,
                )
            }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onStartSelection = { selection.select(it.id) },
    )
    CollectionMenuSheet(state = collectionMenu)

    if (menuOpen) {
        val sort = state.sortMenuState()
        MediaActionSheet(
            expanded = true,
            onDismiss = { menuOpen = false },
            actions = emptyList(),
            extraContent = {
                SortSheetSection(
                    options = sort.options,
                    selectedKey = sort.selectedKey,
                    ascending = sort.ascending,
                    onSelect = viewModel::selectSort,
                    onToggleDirection = viewModel::toggleSortDirection,
                )
            },
        )
    }
}

private data class SortMenuState(
    val options: List<SortOption>,
    val selectedKey: String,
    val ascending: Boolean,
)

private fun LibraryUiState.sortMenuState(): SortMenuState = when (tab) {
    LibraryTab.SONGS -> SortMenuState(SONG_SORT_OPTIONS, songSort.apiValue, songSortDir.isAscending())
    LibraryTab.ALBUMS -> SortMenuState(ALBUM_SORT_OPTIONS, albumSort.apiValue, albumSortDir.isAscending())
    LibraryTab.ARTISTS -> SortMenuState(ARTIST_SORT_OPTIONS, artistSort.apiValue, artistSortDir.isAscending())
    LibraryTab.GENRES -> SortMenuState(emptyList(), "", true)
}

internal fun com.ferrotune.feature.library.data.SortDir.isAscending(): Boolean =
    this == com.ferrotune.feature.library.data.SortDir.ASC

/** Web album card subtitle: "year • artist". */
internal fun albumSubtitle(album: AlbumResponse): String =
    listOfNotNull(album.year?.toString(), album.artist).joinToString(" • ")

internal fun AlbumResponse.toCollectionTarget() = CollectionTarget(
    sourceType = CollectionSource.ALBUM,
    sourceId = id,
    name = name,
    subtitle = artist,
    coverModel = inlineCoverModel(coverArtData),
    artistId = artistId,
    starred = starred != null,
)

internal fun ArtistResponse.toCollectionTarget() = CollectionTarget(
    sourceType = CollectionSource.ARTIST,
    sourceId = id,
    name = name,
    subtitle = artistCounts(this),
    coverModel = inlineCoverModel(coverArtData),
    starred = starred != null,
)

internal fun artistCounts(artist: ArtistResponse): String =
    "${formatCount(artist.albumCount?.toInt() ?: 0, "album")} • ${formatCount(artist.songCount?.toInt() ?: 0, "song")}"

/** Three-column paged grid with the shared loading/error/empty handling. */
@Composable
private fun <T : Any> PagedGrid(
    items: LazyPagingItems<T>,
    gridState: LazyGridState,
    emptyMessage: String,
    key: (T) -> Any,
    content: @Composable (T) -> Unit,
) {
    val refresh = items.loadState.refresh
    LazyVerticalGrid(
        columns = GridCells.Adaptive(MediaGridMinCellWidth),
        state = gridState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            refresh is LoadState.Error && items.itemCount == 0 -> item(span = { GridItemSpan(maxLineSpan) }) {
                ErrorState(message = refresh.error.readableMessage() ?: "Failed to load", onRetry = items::retry)
            }

            refresh is LoadState.Loading && items.itemCount == 0 -> items(12) { MediaCardSkeleton() }

            items.itemCount == 0 -> item(span = { GridItemSpan(maxLineSpan) }) {
                EmptyState(emptyMessage)
            }

            else -> {
                items(count = items.itemCount, key = items.itemKey(key), contentType = { "card" }) { index ->
                    items[index]?.let { content(it) }
                }
                item(span = { GridItemSpan(maxLineSpan) }) {
                    PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
                }
            }
        }
    }
}

@Composable
private fun AlbumsGrid(
    items: LazyPagingItems<AlbumResponse>,
    gridState: LazyGridState,
    collectionMenu: CollectionMenuState,
) {
    val actions = LocalMediaActions.current
    PagedGrid(items = items, gridState = gridState, emptyMessage = "No albums found", key = { it.id }) { album ->
        MediaCard(
            title = album.name,
            subtitle = albumSubtitle(album),
            coverModel = coverModel(album.coverArtData, album.coverArt),
            seed = album.name,
            titleIcon = Icons.Filled.Album,
            onClick = { actions.openAlbum(album.id) },
            onLongClick = { collectionMenu.open(album.toCollectionTarget()) },
        )
    }
}

@Composable
private fun ArtistsGrid(
    items: LazyPagingItems<ArtistResponse>,
    gridState: LazyGridState,
    collectionMenu: CollectionMenuState,
) {
    val actions = LocalMediaActions.current
    PagedGrid(items = items, gridState = gridState, emptyMessage = "No artists found", key = { it.id }) { artist ->
        MediaCard(
            title = artist.name,
            subtitle = artistCounts(artist),
            coverModel = coverModel(artist.coverArtData, artist.coverArt),
            seed = artist.name,
            circularCover = true,
            titleIcon = Icons.Filled.Person,
            onClick = { actions.openArtist(artist.id) },
            onLongClick = { collectionMenu.open(artist.toCollectionTarget()) },
        )
    }
}

@Composable
private fun GenresGrid(
    genres: List<GenreResponse>,
    loading: Boolean,
    error: String?,
    gridState: LazyGridState,
    onRetry: () -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(MediaGridMinCellWidth),
        state = gridState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            error != null && genres.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                ErrorState(message = error, onRetry = onRetry)
            }

            loading && genres.isEmpty() -> items(12) {
                ShimmerBox(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(96.dp),
                    shape = RoundedCornerShape(8.dp),
                )
            }

            genres.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                EmptyState("No genres found")
            }

            else -> items(genres, key = { it.value }) { genre -> GenreTile(genre) }
        }
    }
}

/** Web `GenreCard`: a 96dp seeded-gradient tile with the name and counts. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun GenreTile(genre: GenreResponse, modifier: Modifier = Modifier) {
    val actions = LocalMediaActions.current
    val colors = remember(genre.value) { genreGradientColors(genre.value) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .height(96.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Brush.linearGradient(colors, start = Offset.Zero, end = Offset.Infinite))
            .combinedClickable(onClick = { actions.openGenre(genre.value) })
            .padding(12.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        Text(
            text = genre.value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = "${formatCount(genre.albumCount.toInt(), "album")} • ${formatCount(genre.songCount.toInt(), "song")}",
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.8f),
            maxLines = 2,
        )
    }
}
