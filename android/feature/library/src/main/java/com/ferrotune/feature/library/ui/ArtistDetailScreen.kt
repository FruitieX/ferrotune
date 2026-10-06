package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Person
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionMenuState
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.CoverSize
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.coverUrl
import com.ferrotune.core.actions.fullCoverUrl
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FavoriteButton
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.designsystem.theme.seedBackdropColor
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.library.data.SortDir

/**
 * Web artist page in one scroll: circular-cover header with play, shuffle,
 * favorite, and ⋯; an "Albums" grid; then a "Songs" section with its own
 * filter and sort.
 */
@Composable
fun ArtistDetailScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ArtistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val albums = viewModel.albums.collectAsLazyPagingItems()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    var sortMenuOpen by remember { mutableStateOf(false) }
    val artist = state.artist
    val columns = gridColumns()
    val actions = LocalMediaActions.current

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = artist?.let {
                        {
                            actionsViewModel.loadAllIds(
                                sources = listOf(QueueSourceRequest(sourceType = "artist", sourceId = it.id)),
                                onLoaded = selection::replace,
                            )
                        }
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
                playEnabled = (artist?.songCount ?: 0) > 0,
                actions = {
                    Spacer(Modifier.weight(1f))
                    FavoriteButton(
                        isFavorite = artist?.starred != null,
                        onToggle = viewModel::toggleStar,
                        enabled = artist != null,
                    )
                    IconButton(
                        onClick = {
                            artist?.let {
                                collectionMenu.open(
                                    CollectionTarget(
                                        sourceType = CollectionSource.ARTIST,
                                        sourceId = it.id,
                                        name = it.name,
                                        subtitle = formatCount(it.albumCount?.toInt() ?: 0, "album"),
                                        coverModel = inlineCoverModel(it.coverArtData),
                                    ),
                                )
                            }
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
                    val cover = artist?.let { coverModel(it.coverArtData, it.coverArt, CoverSize.LARGE) }
                    DetailHero(
                        backdropColor = seedBackdropColor(artist?.name.orEmpty()),
                        coverModel = cover,
                        blurredCover = true,
                    ) {
                        DetailHeader(
                            title = artist?.name.orEmpty(),
                            label = "Artist",
                            meta = artist?.let { formatCount(it.albumCount?.toInt() ?: 0, "album") },
                            seed = artist?.name,
                            circularCover = true,
                            coverModel = artist?.coverArt?.let { coverUrl(it, CoverSize.LARGE) },
                            coverFallbackModel = inlineCoverModel(artist?.coverArtData),
                            fullCoverModel = fullCoverUrl(artist?.coverArt),
                            coverPlaceholder = Icons.Filled.Person,
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }

                if (state.error != null && artist == null) {
                    item(key = "error") { ErrorState(message = state.error!!) }
                    return@LazyColumn
                }

                item(key = "albums-title") { SectionTitle("Albums") }
                pagedCardRows(
                    items = albums,
                    columns = columns,
                    keyPrefix = "albums",
                    emptyMessage = "No albums found",
                ) { album ->
                    MediaCard(
                        title = album.name,
                        subtitle = albumSubtitle(album),
                        coverModel = coverModel(album.coverArtData, album.coverArt),
                        seed = album.name,
                        titleIcon = Icons.Filled.Album,
                        onClick = { actions.openAlbum(album.id) },
                        onLongClick = { collectionMenu.open(album.toCollectionTarget()) },
                        modifier = Modifier.weight(1f),
                    )
                }

                item(key = "songs-title") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 16.dp, end = 4.dp, top = 24.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Songs", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        FilterPill(
                            value = state.filter,
                            onValueChange = viewModel::setFilter,
                            placeholder = "Filter songs...",
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { sortMenuOpen = true }) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "Sort options")
                        }
                    }
                }
                songPagingItems(
                    songs = songs,
                    nowPlaying = nowPlaying,
                    menu = songMenu,
                    selection = selection,
                    onPlay = { song, position -> viewModel.play(song.id, position) },
                    emptyMessage = if (state.filter.isBlank()) "No songs found" else "No songs match your filter",
                    index = null,
                    subtitle = { it.album },
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
    CollectionMenuSheet(state = collectionMenu)
    if (sortMenuOpen) {
        MediaActionSheet(
            expanded = true,
            onDismiss = { sortMenuOpen = false },
            actions = emptyList(),
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
}

@Composable
internal fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 12.dp),
    )
}
