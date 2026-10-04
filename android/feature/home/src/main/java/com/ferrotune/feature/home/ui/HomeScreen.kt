package com.ferrotune.feature.home.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.CollectionMenuSheet
import com.ferrotune.core.actions.CollectionMenuState
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.NowPlaying
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongMenuState
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.coverUrl
import com.ferrotune.core.actions.rememberCollectionMenuState
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.toMenuTarget
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaActionSeparator
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.MediaCard
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.PageTitle
import com.ferrotune.core.designsystem.components.ShelfCard
import com.ferrotune.core.designsystem.components.ShelfCardWidth
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.model.Account
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse

/** Web home shelves: 8dp gaps with 12dp side padding on phones. */
private val ShelfGap = 8.dp
private val ShelfPadding = 12.dp

/**
 * The web Home page: account button, "Home", and a search field that opens
 * Search; then the quick tiles and each configured section as a titled shelf
 * with play, shuffle, and "View all".
 */
@Composable
fun HomeScreen(
    accounts: List<Account>,
    activeAccountId: String?,
    onSwitchAccount: (String) -> Unit,
    onAddAccount: () -> Unit,
    onSignOut: () -> Unit,
    onOpenLink: (HomeLinkTarget) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenStats: () -> Unit,
    onOpenReview: () -> Unit,
    onOpenDownloads: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var accountMenuOpen by remember { mutableStateOf(false) }
    val songMenu = rememberSongMenuState()
    val collectionMenu = rememberCollectionMenuState()
    val nowPlaying = rememberNowPlaying()

    Column(modifier = modifier.fillMaxSize()) {
        HomeHeader(
            onOpenAccountMenu = { accountMenuOpen = true },
            onOpenSearch = onOpenSearch,
        )
        when {
            state.loading && state.sections.isEmpty() -> HomeSkeleton(Modifier.fillMaxSize())

            state.error != null && state.sections.isEmpty() -> Box(Modifier.fillMaxSize()) {
                ErrorState(message = state.error!!, onRetry = viewModel::load)
            }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
            ) {
                if (state.tiles.isNotEmpty()) {
                    item(key = "tiles") {
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
                        HomeSectionHeader(
                            section = section,
                            onPlay = { viewModel.playSection(section, shuffle = false) },
                            onShuffle = { viewModel.playSection(section, shuffle = true) },
                            onViewAll = { onOpenLink(HomeLinkTarget.Section(section.config.id)) },
                        )
                    }
                    item(key = "row-${section.config.id}") {
                        when {
                            section.entries.isNotEmpty() -> ContinueListeningShelf(
                                entries = section.entries,
                                sections = state.sections,
                                collectionMenu = collectionMenu,
                                onOpenLink = onOpenLink,
                            )

                            section.albums.isNotEmpty() -> AlbumShelf(
                                albums = section.albums,
                                collectionMenu = collectionMenu,
                            )

                            else -> SongShelf(
                                songs = section.songs,
                                nowPlaying = nowPlaying,
                                songMenu = songMenu,
                            )
                        }
                    }
                }
            }
        }
    }

    SongMenuSheet(
        state = songMenu,
        onPlay = { target ->
            val section = state.sections.firstOrNull { s -> s.songs.any { it.id == target.id } }
            val position = section?.songs?.indexOfFirst { it.id == target.id } ?: -1
            val song = section?.songs?.getOrNull(position)
            if (section != null && song != null) viewModel.playSong(section, song, position)
        },
    )
    CollectionMenuSheet(state = collectionMenu)

    if (accountMenuOpen) {
        AccountMenuSheet(
            accounts = accounts,
            activeAccountId = activeAccountId,
            onDismiss = { accountMenuOpen = false },
            onSwitchAccount = onSwitchAccount,
            onAddAccount = onAddAccount,
            onSignOut = onSignOut,
            onOpenStats = onOpenStats,
            onOpenReview = onOpenReview,
            onOpenDownloads = onOpenDownloads,
        )
    }
}

/** Web mobile home header: account icon, "Home", and a search pill. */
@Composable
private fun HomeHeader(onOpenAccountMenu: () -> Unit, onOpenSearch: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(start = 4.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconButton(onClick = onOpenAccountMenu) {
            Icon(Icons.Filled.Person, contentDescription = "Account")
        }
        PageTitle("Home")
        Row(
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp)
                .height(40.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.secondary)
                .clickable(onClick = onOpenSearch)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = "Search...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Web account menu: saved accounts, profile pages, add account, sign out. */
@Composable
private fun AccountMenuSheet(
    accounts: List<Account>,
    activeAccountId: String?,
    onDismiss: () -> Unit,
    onSwitchAccount: (String) -> Unit,
    onAddAccount: () -> Unit,
    onSignOut: () -> Unit,
    onOpenStats: () -> Unit,
    onOpenReview: () -> Unit,
    onOpenDownloads: () -> Unit,
) {
    MediaActionSheet(
        expanded = true,
        onDismiss = onDismiss,
        actions = emptyList(),
        extraContent = {
            if (accounts.size > 1) {
                Text(
                    text = "Accounts",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                accounts.forEach { account ->
                    val current = account.id == activeAccountId
                    MediaActionRow(
                        icon = Icons.Filled.Person,
                        label = account.label,
                        onClick = { if (!current) onSwitchAccount(account.id) },
                        trailing = if (current) {
                            {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = "Current account",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        } else {
                            null
                        },
                    )
                }
                MediaActionSeparator()
            }
            MediaActionRow(icon = Icons.Filled.BarChart, label = "Profile & stats", onClick = onOpenStats)
            MediaActionRow(icon = Icons.Filled.EventNote, label = "Listening review", onClick = onOpenReview)
            MediaActionRow(icon = Icons.Filled.DownloadForOffline, label = "Downloads", onClick = onOpenDownloads)
            MediaActionRow(icon = Icons.Filled.Add, label = "Add account", onClick = onAddAccount)
            MediaActionSeparator()
            MediaActionRow(icon = Icons.Filled.Logout, label = "Sign out", onClick = onSignOut)
        },
    )
}

@Composable
private fun HomeSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(top = 4.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = ShelfPadding),
        ) {
            repeat(2) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(2) {
                        ShimmerBox(
                            modifier = Modifier
                                .weight(1f)
                                .height(56.dp),
                            shape = RoundedCornerShape(8.dp),
                        )
                    }
                }
            }
        }
        repeat(2) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ShimmerBox(
                    modifier = Modifier
                        .padding(horizontal = 16.dp)
                        .width(180.dp)
                        .height(22.dp),
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(ShelfGap),
                    modifier = Modifier.padding(horizontal = ShelfPadding),
                ) {
                    repeat(3) { MediaCardSkeleton(width = ShelfCardWidth) }
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
            .padding(horizontal = ShelfPadding, vertical = 4.dp),
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
                if (rowTiles.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** Web quick tile: `bg-card` with a soft border, tinted icon square, label + subtitle. */
@Composable
private fun HomeQuickTile(
    tile: HomeTilePresentation,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier = modifier
            .heightIn(min = 56.dp)
            .alpha(if (tile.isIncomplete) 0.6f else 1f)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f), shape)
            .clickable(enabled = !tile.isIncomplete, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = tile.icon,
                contentDescription = null,
                tint = Color(tile.iconColor),
                modifier = Modifier.size(20.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
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

/** Web section header: primary icon, bold title, play, shuffle, "View all". */
@Composable
private fun HomeSectionHeader(
    section: HomeSectionUi,
    onPlay: () -> Unit,
    onShuffle: () -> Unit,
    onViewAll: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 4.dp, top = 20.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = homeSectionIcon(section.config),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(22.dp),
        )
        Text(
            text = homeSectionLabel(section.config),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .padding(start = 8.dp)
                .clickable(onClick = onViewAll),
        )
        IconButton(onClick = onPlay, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "Play all", modifier = Modifier.size(22.dp))
        }
        IconButton(onClick = onShuffle, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle all", modifier = Modifier.size(20.dp))
        }
        Text(
            text = "View all",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable(onClick = onViewAll)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun ContinueListeningShelf(
    entries: List<ContinueListeningEntry>,
    sections: List<HomeSectionUi>,
    collectionMenu: CollectionMenuState,
    onOpenLink: (HomeLinkTarget) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = ShelfPadding),
        horizontalArrangement = Arrangement.spacedBy(ShelfGap),
    ) {
        items(entries, key = { "${it.type}-${it.album?.id ?: it.playlist?.id ?: it.source?.id}" }) { entry ->
            ContinueListeningCard(
                entry = entry,
                sections = sections.map { it.config },
                collectionMenu = collectionMenu,
                onOpenLink = onOpenLink,
                modifier = Modifier.width(ShelfCardWidth),
            )
        }
    }
}


/** A continue-listening entry (album, playlist, or other source) as a web media card. */
@Composable
internal fun ContinueListeningCard(
    entry: ContinueListeningEntry,
    sections: List<HomeSectionConfig>,
    collectionMenu: CollectionMenuState,
    onOpenLink: (HomeLinkTarget) -> Unit,
    modifier: Modifier = Modifier,
) {
    val album = entry.album
    val playlist = entry.playlist
    val source = entry.source
    val name = album?.name ?: playlist?.name ?: source?.name ?: "Continue"
    val isSmart = playlist?.playlistType == "smartPlaylist"
    val cover = when {
        album != null -> coverModel(album.coverArtData, album.coverArt)
        playlist != null -> coverUrl(if (isSmart) "sp-${playlist.id}" else playlist.id)
        else -> coverUrl(source?.coverArt)
    }
    val subtitle = when {
        album != null -> listOfNotNull(album.year?.toString(), album.artist).joinToString(" • ")
        playlist != null -> playlist.songCount?.let { formatCount(it.toInt(), "song") }
            ?: if (isSmart) "Smart playlist" else "Playlist"
        else -> entry.type.toLabel()
    }
    val target = when {
        album != null -> HomeLinkTarget.Album(album.id)
        isSmart -> HomeLinkTarget.SmartPlaylist(playlist!!.id)
        playlist != null -> HomeLinkTarget.Playlist(playlist.id)
        source != null -> queueSourceLinkTarget(
            sourceType = source.sourceType,
            sourceId = source.id,
            sourceName = source.name,
            sections = sections,
        )
        else -> null
    }
    val collectionTarget = when {
        album != null -> CollectionTarget(
            sourceType = CollectionSource.ALBUM,
            sourceId = album.id,
            name = album.name,
            subtitle = album.artist,
            coverModel = cover,
            artistId = album.artistId,
            starred = album.starred != null,
        )

        playlist != null -> CollectionTarget(
            sourceType = if (isSmart) CollectionSource.SMART_PLAYLIST else CollectionSource.PLAYLIST,
            sourceId = playlist.id,
            name = playlist.name,
            subtitle = subtitle,
            coverModel = cover,
        )

        else -> null
    }
    MediaCard(
        title = name,
        subtitle = subtitle,
        coverModel = cover,
        seed = name,
        titleIcon = when {
            album != null -> Icons.Filled.Album
            isSmart -> Icons.Filled.AutoAwesome
            playlist != null -> Icons.AutoMirrored.Filled.QueueMusic
            else -> null
        },
        onClick = { target?.let(onOpenLink) },
        onLongClick = collectionTarget?.let { { collectionMenu.open(it) } },
        modifier = modifier,
    )
}

@Composable
private fun AlbumShelf(
    albums: List<AlbumResponse>,
    collectionMenu: CollectionMenuState,
) {
    val actions = LocalMediaActions.current
    LazyRow(
        contentPadding = PaddingValues(horizontal = ShelfPadding),
        horizontalArrangement = Arrangement.spacedBy(ShelfGap),
    ) {
        items(albums, key = { it.id }) { album ->
            val cover = coverModel(album.coverArtData, album.coverArt)
            ShelfCard(
                title = album.name,
                subtitle = listOfNotNull(album.year?.toString(), album.artist).joinToString(" • "),
                seed = album.name,
                coverModel = cover,
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
            )
        }
    }
}

/**
 * Song shelf: like the web `SongCard`, tapping opens the song's album and
 * long-press opens the song menu (which can play it within the section).
 */
@Composable
private fun SongShelf(
    songs: List<SongResponse>,
    nowPlaying: NowPlaying,
    songMenu: SongMenuState,
) {
    val actions = LocalMediaActions.current
    LazyRow(
        contentPadding = PaddingValues(horizontal = ShelfPadding),
        horizontalArrangement = Arrangement.spacedBy(ShelfGap),
    ) {
        itemsIndexed(songs, key = { _, song -> song.id }) { _, song ->
            ShelfCard(
                title = song.title,
                subtitle = song.artist,
                seed = song.album ?: song.title,
                coverModel = coverModel(song.coverArtData, song.coverArt),
                titleIcon = Icons.Filled.MusicNote,
                isActive = nowPlaying.songId == song.id,
                onClick = { song.albumId?.let(actions::openAlbum) },
                onLongClick = { songMenu.open(song.toMenuTarget()) },
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
