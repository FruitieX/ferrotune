package com.ferrotune.feature.home.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.AccountSwitcherDialog
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.SectionHeader
import com.ferrotune.core.designsystem.components.ShelfCard
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.home.data.HomeSectionKind

@Composable
fun HomeScreen(
    accountLabel: String?,
    accounts: List<Account>,
    activeAccountId: String?,
    onSwitchAccount: (String) -> Unit,
    onAddAccount: () -> Unit,
    onSignOut: () -> Unit,
    onOpenLink: (HomeLinkTarget) -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
    onOpenStats: () -> Unit,
    onOpenReview: () -> Unit,
    onOpenDownloads: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var menuExpanded by remember { mutableStateOf(false) }
    var accountsDialogVisible by remember { mutableStateOf(false) }

    if (accountsDialogVisible) {
        AccountSwitcherDialog(
            accounts = accounts,
            activeAccountId = activeAccountId,
            onSelect = onSwitchAccount,
            onAddAccount = {
                accountsDialogVisible = false
                onAddAccount()
            },
            onDismiss = { accountsDialogVisible = false },
        )
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Ferrotune") },
                actions = {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "More")
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Stats") },
                            onClick = {
                                menuExpanded = false
                                onOpenStats()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Listening review") },
                            onClick = {
                                menuExpanded = false
                                onOpenReview()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Downloads") },
                            onClick = {
                                menuExpanded = false
                                onOpenDownloads()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Settings") },
                            onClick = {
                                menuExpanded = false
                                onOpenSettings()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Accounts") },
                            onClick = {
                                menuExpanded = false
                                accountsDialogVisible = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Sign out") },
                            onClick = {
                                menuExpanded = false
                                onSignOut()
                            },
                        )
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading && state.sections.isEmpty() -> HomeSkeleton(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.error != null && state.sections.isEmpty() -> Box(
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
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                accountLabel?.let { label ->
                    item {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                }
                if (state.tiles.isNotEmpty()) {
                    item {
                        QuickTiles(
                            tiles = state.tiles,
                            onTileClick = { tile ->
                                when (val action = tile.action) {
                                    is HomeTileAction.Link -> onOpenLink(action.target)
                                    else -> viewModel.onTileAction(action)
                                }
                            },
                        )
                    }
                }
                state.sections.forEach { section ->
                    if (section.isEmpty) return@forEach
                    item(key = "header-${section.config.id}") {
                        SectionHeaderRow(
                            section = section,
                            onPlay = { viewModel.playSection(section.config, shuffle = false) },
                            onShuffle = { viewModel.playSection(section.config, shuffle = true) },
                            onViewAll = {
                                onOpenLink(HomeLinkTarget.Section(section.config.id))
                            },
                        )
                    }
                    item(key = "row-${section.config.id}") {
                        when {
                            section.entries.isNotEmpty() -> ContinueListeningRow(
                                entries = section.entries,
                                serverUrl = state.serverUrl,
                                onClick = viewModel::playContinueListening,
                                onOpenAlbum = onOpenAlbum,
                                onOpenPlaylist = onOpenPlaylist,
                                onOpenSmartPlaylist = onOpenSmartPlaylist,
                            )

                            section.albums.isNotEmpty() -> AlbumRow(
                                albums = section.albums,
                                serverUrl = state.serverUrl,
                                onOpenAlbum = onOpenAlbum,
                            )

                            else -> SongRow(
                                songs = section.songs,
                                onPlay = { song ->
                                    viewModel.playSong(
                                        sourceType = sectionSourceType(section),
                                        sourceName = homeSectionLabel(section.config),
                                        song = song,
                                    )
                                },
                            )
                        }
                    }
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

    state.switchError?.let { message ->
        ConfirmDialog(
            title = "Account switch failed",
            message = message,
            confirmLabel = "OK",
            onDismiss = viewModel::dismissSwitchError,
            onConfirm = viewModel::dismissSwitchError,
        )
    }
}

private fun sectionSourceType(section: HomeSectionUi): String = when (section.config.kind) {
    HomeSectionKind.MOST_PLAYED_RECENTLY ->
        HomeViewModel.SOURCE_TYPE_MOST_PLAYED

    HomeSectionKind.FORGOTTEN_FAVORITES ->
        HomeViewModel.SOURCE_TYPE_FORGOTTEN_FAVORITES

    HomeSectionKind.SIMILAR_TRACKS ->
        HomeViewModel.SOURCE_TYPE_SIMILAR_TRACKS

    else -> homeSectionQueueSpec(section.config, shuffle = false).sourceType
}

@Composable
private fun HomeSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 16.dp),
        ) {
            repeat(2) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ShimmerBox(
                        modifier = Modifier
                            .weight(1f)
                            .height(60.dp),
                        shape = MaterialTheme.shapes.medium,
                    )
                    ShimmerBox(
                        modifier = Modifier
                            .weight(1f)
                            .height(60.dp),
                        shape = MaterialTheme.shapes.medium,
                    )
                }
            }
        }
        repeat(2) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ShimmerBox(
                    modifier = Modifier
                        .padding(horizontal = 16.dp)
                        .width(160.dp)
                        .height(20.dp),
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    repeat(3) { MediaCardSkeleton(width = 148.dp) }
                }
            }
        }
    }
}

@Composable
private fun QuickTiles(
    tiles: List<HomeTilePresentation>,
    onTileClick: (HomeTilePresentation) -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        tiles.chunked(2).forEach { rowTiles ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowTiles.forEach { tile ->
                    HomeQuickTile(
                        tile = tile,
                        onClick = { onTileClick(tile) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (rowTiles.size == 1) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun HomeQuickTile(
    tile: HomeTilePresentation,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = modifier
            .alpha(if (tile.isIncomplete) 0.6f else 1f)
            .clickable(enabled = !tile.isIncomplete, onClick = onClick),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Surface(
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = tile.icon,
                        contentDescription = null,
                        modifier = Modifier.size(21.dp),
                    )
                }
            }
            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(
                    text = tile.label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = tile.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun SectionHeaderRow(
    section: HomeSectionUi,
    onPlay: () -> Unit,
    onShuffle: () -> Unit,
    onViewAll: () -> Unit,
) {
    SectionHeader(
        title = homeSectionLabel(section.config),
        modifier = Modifier.clickable(onClick = onViewAll),
        leading = {
            Icon(
                imageVector = homeSectionIcon(section.config),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
        },
        actions = {
            IconButton(
                onClick = onPlay,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Play all",
                    modifier = Modifier.size(22.dp),
                )
            }
            IconButton(
                onClick = onShuffle,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    Icons.Filled.Shuffle,
                    contentDescription = "Shuffle all",
                    modifier = Modifier.size(20.dp),
                )
            }
            IconButton(
                onClick = onViewAll,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = "View all",
                    modifier = Modifier.size(24.dp),
                )
            }
        },
    )
}

@Composable
private fun ContinueListeningRow(
    entries: List<ContinueListeningEntry>,
    serverUrl: String?,
    onClick: (ContinueListeningEntry) -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(entries, key = { "${it.type}-${it.album?.id ?: it.playlist?.id ?: it.source?.id}" }) { entry ->
            val album = entry.album
            val playlist = entry.playlist
            val source = entry.source
            val name = album?.name
                ?: playlist?.name
                ?: source?.name
                ?: "Continue"
            val coverModel = album?.coverArtData?.let(::inlineCoverModel)
                ?: serverUrl?.let { base ->
                    val coverId = when {
                        album != null -> album.id
                        playlist?.playlistType == "smartPlaylist" -> "sp-${playlist.id}"
                        playlist != null -> playlist.id
                        else -> source?.coverArt
                    }
                    coverId?.let { coverArtUrl(serverUrl = base, coverArtId = it, size = "small") }
                }
            ShelfCard(
                title = name,
                subtitle = entry.type.toLabel(),
                coverModel = coverModel,
                seed = name,
                onClick = {
                    when {
                        entry.type == HomeViewModel.SOURCE_TYPE_ALBUM && album != null ->
                            onOpenAlbum(album.id)

                        entry.type == HomeViewModel.SOURCE_TYPE_SMART_PLAYLIST &&
                            playlist != null ->
                            onOpenSmartPlaylist(playlist.id)

                        entry.type == HomeViewModel.SOURCE_TYPE_PLAYLIST &&
                            playlist != null ->
                            onOpenPlaylist(playlist.id)

                        else -> onClick(entry)
                    }
                },
            )
        }
    }
}

@Composable
private fun AlbumRow(
    albums: List<AlbumResponse>,
    serverUrl: String?,
    onOpenAlbum: (String) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(albums, key = { it.id }) { album ->
            ShelfCard(
                title = album.name,
                subtitle = album.artist,
                seed = album.id,
                coverModel = inlineCoverModel(album.coverArtData)
                    ?: serverUrl?.let {
                        coverArtUrl(serverUrl = it, coverArtId = album.id, size = "small")
                    },
                onClick = { onOpenAlbum(album.id) },
            )
        }
    }
}

@Composable
private fun SongRow(
    songs: List<SongResponse>,
    onPlay: (SongResponse) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(songs, key = { it.id }) { song ->
            ShelfCard(
                title = song.title,
                subtitle = song.artist,
                seed = song.id,
                coverModel = inlineCoverModel(song.coverArtData),
                onClick = { onPlay(song) },
                onPlay = { onPlay(song) },
            )
        }
    }
}

private fun String.toLabel(): String = when (this) {
    "album" -> "Album"
    "playlist" -> "Playlist"
    "smartPlaylist" -> "Smart playlist"
    "songRadio" -> "Song radio"
    "albumList" -> "Album list"
    "favorites" -> "Favorites"
    "history" -> "History"
    "forgottenFavorites" -> "Forgotten favorites"
    "mostPlayedRecently" -> "Most played"
    "similarTracks" -> "Similar tracks"
    else -> replaceFirstChar { it.uppercase() }
}
