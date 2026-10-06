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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.collectAsLazyPagingItems
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongSelectionActionBar
import com.ferrotune.core.actions.SongSelectionTopBar
import com.ferrotune.core.actions.discHeader
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.rememberSongSelectionState
import com.ferrotune.core.actions.songPagingItems
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.FilterPill
import com.ferrotune.core.designsystem.components.SortSheetSection
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatTotalDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.theme.seedBackdropColor
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.feature.downloads.ui.ContainerDownloadMenuItem
import com.ferrotune.feature.downloads.ui.ContainerDownloadType
import com.ferrotune.feature.library.data.SortDir

/**
 * Web album page: blurred-cover header (cover, "Album", title, artist link,
 * year/genre/count/duration), play/shuffle/filter/⋯ action bar, then the
 * numbered track list with disc separators. The header scrolls with the list.
 */
@Composable
fun AlbumDetailScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: AlbumDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val songs = viewModel.songs.collectAsLazyPagingItems()
    val actions = LocalMediaActions.current
    val actionsViewModel: SongActionsViewModel = hiltViewModel()
    val selectingAll by actionsViewModel.selectingAll.collectAsStateWithLifecycle()
    val selection = rememberSongSelectionState()
    val songMenu = rememberSongMenuState()
    val albumMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    val album = state.album

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            if (selection.isActive) {
                SongSelectionTopBar(
                    selectedCount = selection.count,
                    onClose = selection::clear,
                    onSelectAll = album?.let {
                        {
                            actionsViewModel.loadAllIds(
                                sources = listOf(QueueSourceRequest(sourceType = "album", sourceId = it.id)),
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
        val inlineCover = inlineCoverModel(album?.coverArtData)
        val largeCover = album?.coverArt?.let { id -> state.serverUrl?.let { coverArtUrl(it, id, "large") } }
        val actionBar: @Composable () -> Unit = {
            DetailActionBar(
                onPlayAll = { viewModel.play() },
                onShuffle = { viewModel.play(shuffle = true) },
                playEnabled = album != null && album.songCount > 0,
                actions = {
                    FilterPill(
                        value = state.filter,
                        onValueChange = viewModel::setFilter,
                        placeholder = "Filter songs...",
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            album?.let {
                                albumMenu.open(
                                    CollectionTarget(
                                        sourceType = CollectionSource.ALBUM,
                                        sourceId = it.id,
                                        name = it.name,
                                        subtitle = it.artist,
                                        coverModel = inlineCover,
                                        artistId = it.artistId,
                                        starred = it.starred != null,
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
                    DetailHero(
                        backdropColor = seedBackdropColor(album?.name.orEmpty()),
                        coverModel = inlineCover ?: largeCover,
                        blurredCover = true,
                    ) {
                        DetailHeader(
                            title = album?.name ?: if (state.loading) "" else "Album",
                            label = "Album",
                            subtitle = album?.artist,
                            meta = album?.let {
                                listOfNotNull(
                                    it.year?.toString(),
                                    it.genre,
                                    formatCount(it.songCount.toInt(), "song"),
                                    formatTotalDuration(it.duration),
                                ).joinToString(" • ")
                            },
                            seed = album?.name,
                            coverModel = largeCover,
                            coverFallbackModel = inlineCover,
                            fullCoverModel = album?.coverArt?.let { id -> state.serverUrl?.let { coverArtUrl(it, id) } },
                            showBackButton = !selection.isActive,
                            onBack = onBack,
                            onSubtitleClick = album?.let { { actions.openArtist(it.artistId) } },
                        )
                    }
                }
                item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
                if (state.error != null && album == null) {
                    item(key = "error") { ErrorState(message = state.error!!) }
                } else {
                    item(key = "columns") { TrackListHeader() }
                    songPagingItems(
                        songs = songs,
                        nowPlaying = nowPlaying,
                        menu = songMenu,
                        selection = selection,
                        onPlay = { song, position -> viewModel.play(song.id, position) },
                        emptyMessage = if (state.filter.isBlank()) "No songs on this album" else "No songs match your filter",
                        index = { song, position -> song.track ?: (position + 1) },
                        subtitle = { song -> song.artist.takeIf { it != album?.artist } },
                        groupHeader = ::discHeader,
                    )
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
    CollectionMenuSheet(
        state = albumMenu,
        extraContent = { target ->
            ContainerDownloadMenuItem(
                type = ContainerDownloadType.ALBUM,
                sourceId = target.sourceId,
                name = target.name.orEmpty(),
                coverArtId = album?.coverArt,
            )
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
