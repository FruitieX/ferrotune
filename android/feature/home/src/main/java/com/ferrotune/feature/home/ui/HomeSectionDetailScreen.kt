package com.ferrotune.feature.home.ui

import com.ferrotune.core.designsystem.components.rememberActionBarPinned
import com.ferrotune.core.designsystem.components.PinnedActionBar
import com.ferrotune.core.designsystem.components.ACTION_BAR_ITEM_KEY
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongListRow
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.designsystem.components.DetailActionBar
import com.ferrotune.core.designsystem.components.DetailHeader
import com.ferrotune.core.designsystem.components.DetailHero
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind

/** Web home-section header colors: icon tile gradient and backdrop tint. */
private data class SectionStyle(val gradient: List<Color>, val backdrop: Color)

private fun sectionStyle(kind: HomeSectionKind): SectionStyle = when (kind) {
    HomeSectionKind.CONTINUE_LISTENING, HomeSectionKind.SIMILAR_TRACKS, HomeSectionKind.PLAYLIST_SONGS ->
        SectionStyle(listOf(Color(0xFF10B981), Color(0xFF0E7490)), Color(0x3810B981))

    HomeSectionKind.MOST_PLAYED_RECENTLY, HomeSectionKind.TOP_ALBUMS ->
        SectionStyle(listOf(Color(0xFFF43F5E), Color(0xFFD97706)), Color(0x33F43F5E))

    HomeSectionKind.RECENTLY_ADDED, HomeSectionKind.RECENT_ALBUMS ->
        SectionStyle(listOf(Color(0xFF0EA5E9), Color(0xFF1D4ED8)), Color(0x330EA5E9))

    HomeSectionKind.FORGOTTEN_FAVORITES ->
        SectionStyle(listOf(Color(0xFFF59E0B), Color(0xFF0F766E)), Color(0x33F59E0B))

    HomeSectionKind.DISCOVER ->
        SectionStyle(listOf(Color(0xFF8B5CF6), Color(0xFFA21CAF)), Color(0x338B5CF6))
}

/** Web home-section page ("View all"): section header, actions, and every item. */
@Composable
fun HomeSectionDetailScreen(
    onBack: () -> Unit,
    onOpenLink: (HomeLinkTarget) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeSectionDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val section = state.section
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()
    val actions = LocalMediaActions.current
    val columns = (LocalConfiguration.current.screenWidthDp / 128).coerceAtLeast(3)
    val style = sectionStyle(section?.kind ?: HomeSectionKind.CONTINUE_LISTENING)
    val itemCount = state.songs.size + state.albums.size + state.entries.size

    val actionBar: @Composable () -> Unit = {
        DetailActionBar(
            onPlayAll = { viewModel.playAll(shuffle = false) },
            onShuffle = { viewModel.playAll(shuffle = true) },
            playEnabled = itemCount > 0,
        )
    }
    val listState = rememberLazyListState()
    val actionBarPinned by rememberActionBarPinned(listState)
    Box(modifier = modifier.fillMaxSize()) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item(key = "hero") {
                DetailHero(backdropColor = style.backdrop) {
                    DetailHeader(
                        title = section?.let(::homeSectionLabel).orEmpty(),
                        label = "Home",
                        meta = if (state.loading) null else sectionSummary(state),
                        icon = section?.let(::homeSectionIcon),
                        iconGradient = style.gradient,
                        showBackButton = true,
                        onBack = onBack,
                    )
                }
            }
            item(key = ACTION_BAR_ITEM_KEY) { actionBar() }
            when {
                state.loading -> item(key = "loading") { MediaRowSkeletonList(count = 8) }
                state.error != null -> item(key = "error") {
                    ErrorState(message = state.error!!, onRetry = viewModel::load)
                }

                itemCount == 0 -> item(key = "empty") { EmptyState(message = "Nothing to show yet") }

                state.songs.isNotEmpty() -> {
                    item(key = "columns") { TrackListHeader() }
                    itemsIndexed(state.songs, key = { _, song -> song.id }) { index, song ->
                        SongListRow(
                            song = song,
                            nowPlaying = nowPlaying,
                            menu = songMenu,
                            index = index + 1,
                            onPlay = { viewModel.playSong(song, index) },
                        )
                    }
                }

                state.albums.isNotEmpty() -> cardRows(state.albums.size, columns) { index, cardModifier ->
                    val album = state.albums[index]
                    val cover = coverModel(album.coverArtData, album.coverArt)
                    MediaCard(
                        title = album.name,
                        subtitle = listOfNotNull(album.year?.toString(), album.artist).joinToString(" • "),
                        coverModel = cover,
                        seed = album.name,
                        titleIcon = Icons.Filled.Album,
                        onClick = { actions.openAlbum(album.id) },
                        onLongClick = {
                            collectionMenu.open(
                                CollectionTarget(
                                    sourceType = CollectionSource.ALBUM,
                                    sourceId = album.id,
                                    name = album.name,
                                    subtitle = album.artist,
                                    coverModel = cover,
                                    artistId = album.artistId,
                                    starred = album.starred != null,
                                ),
                            )
                        },
                        modifier = cardModifier,
                    )
                }

                else -> cardRows(state.entries.size, columns) { index, cardModifier ->
                    ContinueListeningCard(
                        entry = state.entries[index],
                        sections = listOfNotNull<HomeSectionConfig>(section),
                        collectionMenu = collectionMenu,
                        onOpenLink = onOpenLink,
                        modifier = cardModifier,
                    )
                }
            }
        }
        PinnedActionBar(visible = actionBarPinned) { actionBar() }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { target ->
            val index = state.songs.indexOfFirst { it.id == target.id }
            state.songs.getOrNull(index)?.let { viewModel.playSong(it, index) }
        },
    )
    CollectionMenuSheet(state = collectionMenu)
}

private fun sectionSummary(state: HomeSectionDetailUiState): String = when {
    state.songs.isNotEmpty() -> formatCount(state.songs.size, "song")
    state.albums.isNotEmpty() -> formatCount(state.albums.size, "album")
    else -> formatCount(state.entries.size, "item")
}

/** Cards in rows of [columns], each given a weighted modifier. */
private fun LazyListScope.cardRows(
    count: Int,
    columns: Int,
    card: @Composable (index: Int, modifier: Modifier) -> Unit,
) {
    val rows = (count + columns - 1) / columns
    items(rows, key = { "card-row-$it" }) { row ->
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (column in 0 until columns) {
                val index = row * columns + column
                if (index < count) card(index, Modifier.weight(1f)) else Spacer(Modifier.weight(1f))
            }
        }
    }
}
