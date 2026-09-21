package com.ferrotune.feature.home.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.ErrorState
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
            state.loading && state.sections.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

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
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier
            .alpha(if (tile.isIncomplete) 0.6f else 1f)
            .clickable(enabled = !tile.isIncomplete, onClick = onClick),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = tile.icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp),
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
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Icon(
            imageVector = homeSectionIcon(section.config),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Text(
            text = homeSectionLabel(section.config),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp),
        )
        IconButton(onClick = onPlay) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "Play all")
        }
        IconButton(onClick = onShuffle) {
            Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle all")
        }
        TextButton(onClick = onViewAll) { Text("View all") }
    }
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
            Column(
                modifier = Modifier
                    .width(132.dp)
                    .clickable {
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
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CoverArt(
                    model = coverModel,
                    contentDescription = name,
                    modifier = Modifier.size(132.dp),
                )
                Text(
                    text = name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = entry.type.toLabel(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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
            Column(
                modifier = Modifier
                    .width(132.dp)
                    .clickable { onOpenAlbum(album.id) },
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CoverArt(
                    model = inlineCoverModel(album.coverArtData)
                        ?: serverUrl?.let {
                            coverArtUrl(serverUrl = it, coverArtId = album.id, size = "small")
                        },
                    contentDescription = album.name,
                    modifier = Modifier.size(132.dp),
                )
                Text(
                    text = album.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
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
            Column(
                modifier = Modifier
                    .width(132.dp)
                    .clickable { onPlay(song) },
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                CoverArt(
                    model = inlineCoverModel(song.coverArtData),
                    contentDescription = song.title,
                    modifier = Modifier.size(132.dp),
                )
                Text(
                    text = song.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = song.artist,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
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
