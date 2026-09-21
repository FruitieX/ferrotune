package com.ferrotune.feature.home.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.designsystem.components.ConfirmDialog

@Composable
fun HomeScreen(
    accountLabel: String?,
    onSwitchAccount: () -> Unit,
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
                            text = { Text("Switch account") },
                            onClick = {
                                menuExpanded = false
                                onSwitchAccount()
                            },
                        )
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading && state.page == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            state.error != null && state.page == null -> Box(
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
                val page = state.page ?: return@LazyColumn
                if (page.continueListening.entries.isNotEmpty()) {
                    item { SectionTitle("Continue listening") }
                    item {
                        ContinueListeningRow(
                            entries = page.continueListening.entries,
                            serverUrl = state.serverUrl,
                            onClick = viewModel::playContinueListening,
                            onOpenAlbum = onOpenAlbum,
                            onOpenPlaylist = onOpenPlaylist,
                            onOpenSmartPlaylist = onOpenSmartPlaylist,
                        )
                    }
                }
                if (page.mostPlayedRecently.song.isNotEmpty()) {
                    item { SectionTitle("Most played recently") }
                    item {
                        SongRow(
                            songs = page.mostPlayedRecently.song,
                            onPlay = {
                                viewModel.playSection(
                                    HomeViewModel.SOURCE_TYPE_MOST_PLAYED,
                                    "Most played recently",
                                    it,
                                )
                            },
                        )
                    }
                }
                if (page.recentlyAdded.album.isNotEmpty()) {
                    item { SectionTitle("Recently added") }
                    item {
                        AlbumRow(
                            albums = page.recentlyAdded.album,
                            serverUrl = state.serverUrl,
                            onOpenAlbum = onOpenAlbum,
                        )
                    }
                }
                if (page.forgottenFavorites.song.isNotEmpty()) {
                    item { SectionTitle("Forgotten favorites") }
                    item {
                        SongRow(
                            songs = page.forgottenFavorites.song,
                            onPlay = {
                                viewModel.playSection(
                                    HomeViewModel.SOURCE_TYPE_FORGOTTEN_FAVORITES,
                                    "Forgotten favorites",
                                    it,
                                )
                            },
                        )
                    }
                }
                if (page.discover.album.isNotEmpty()) {
                    item { SectionTitle("Discover") }
                    item {
                        AlbumRow(
                            albums = page.discover.album,
                            serverUrl = state.serverUrl,
                            onOpenAlbum = onOpenAlbum,
                        )
                    }
                }
                if (page.similarTracks.song.isNotEmpty()) {
                    item { SectionTitle("Similar tracks") }
                    item {
                        SongRow(
                            songs = page.similarTracks.song,
                            onPlay = {
                                viewModel.playSection(
                                    HomeViewModel.SOURCE_TYPE_SIMILAR_TRACKS,
                                    "Similar tracks",
                                    it,
                                )
                            },
                        )
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
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
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
