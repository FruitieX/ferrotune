package com.ferrotune.feature.home.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.CollectionActionSheet
import com.ferrotune.core.actions.CollectionSource
import com.ferrotune.core.actions.CollectionTarget
import com.ferrotune.core.actions.SongActionSheet
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.designsystem.components.ConfirmDialog
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.network.coverArtUrl

@Composable
fun HomeSectionDetailScreen(
    onBack: () -> Unit,
    onOpenAlbum: (String) -> Unit,
    onOpenPlaylist: (String) -> Unit,
    onOpenSmartPlaylist: (String) -> Unit,
    onOpenLink: (HomeLinkTarget) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeSectionDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val section = state.section

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(section?.let(::homeSectionLabel) ?: "Home") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.playAll(shuffle = false) }) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = "Play all")
                    }
                    IconButton(onClick = { viewModel.playAll(shuffle = true) }) {
                        Icon(Icons.Filled.Shuffle, contentDescription = "Shuffle all")
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            state.error != null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                ErrorState(message = state.error!!, onRetry = viewModel::load)
            }

            state.songs.isEmpty() && state.albums.isEmpty() && state.entries.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                EmptyState(message = "Nothing to show yet")
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                
                items(state.entries, key = { "entry-${it.type}-${it.album?.id ?: it.playlist?.id ?: it.source?.id}" }) { entry ->
                    val album = entry.album
                    val playlist = entry.playlist
                    val source = entry.source
                    val entrySourceType = when (entry.type) {
                        "album" -> CollectionSource.ALBUM
                        "playlist" -> CollectionSource.PLAYLIST
                        "smartPlaylist" -> CollectionSource.SMART_PLAYLIST
                        else -> null
                    }
                    val entrySourceId = album?.id ?: playlist?.id
                    val sourceTarget = source?.let {
                        queueSourceLinkTarget(
                            sourceType = it.sourceType,
                            sourceId = it.id,
                            sourceName = it.name,
                            sections = listOfNotNull(section),
                        )
                    }
                    var entryMenuExpanded by remember { mutableStateOf(false) }
                    Box {
                        MediaRow(
                            title = album?.name ?: playlist?.name ?: source?.name ?: "Continue",
                            subtitle = entry.type,
                            coverModel = album?.coverArtData?.let(::inlineCoverModel)
                                ?: state.serverUrl?.let { base ->
                                    val coverId = when {
                                        album != null -> album.id
                                        playlist?.playlistType == "smartPlaylist" -> "sp-${playlist.id}"
                                        playlist != null -> playlist.id
                                        else -> source?.coverArt
                                    }
                                    coverId?.let {
                                        coverArtUrl(serverUrl = base, coverArtId = it, size = "small")
                                    }
                                },
                            onClick = {
                                when {
                                    entry.type == "album" && album != null -> onOpenAlbum(album.id)
                                    entry.type == "smartPlaylist" && playlist != null ->
                                        onOpenSmartPlaylist(playlist.id)

                                    entry.type == "playlist" && playlist != null ->
                                        onOpenPlaylist(playlist.id)

                                    sourceTarget != null -> onOpenLink(sourceTarget)

                                    else -> viewModel.playEntry(entry)
                                }
                            },
                            onLongClick = {
                                if (entrySourceType != null && entrySourceId != null) {
                                    entryMenuExpanded = true
                                }
                            },
                            trailing = {
                                IconButton(onClick = { viewModel.playEntry(entry) }) {
                                    Icon(
                                        Icons.Filled.PlayArrow,
                                        contentDescription = "Play",
                                        modifier = Modifier.size(24.dp),
                                    )
                                }
                            },
                        )
                        if (entrySourceType != null && entrySourceId != null) {
                            CollectionActionSheet(
                                expanded = entryMenuExpanded,
                                onDismiss = { entryMenuExpanded = false },
                                target = CollectionTarget(
                                    sourceType = entrySourceType,
                                    sourceId = entrySourceId,
                                    name = album?.name ?: playlist?.name,
                                ),
                                title = album?.name ?: playlist?.name ?: source?.name,
                                subtitle = entry.type,
                                coverModel = album?.coverArtData?.let(::inlineCoverModel)
                                    ?: state.serverUrl?.let { base ->
                                        val coverId = when {
                                            album != null -> album.id
                                            playlist?.playlistType == "smartPlaylist" ->
                                                "sp-${playlist.id}"

                                            playlist != null -> playlist.id
                                            else -> source?.coverArt
                                        }
                                        coverId?.let {
                                            coverArtUrl(
                                                serverUrl = base,
                                                coverArtId = it,
                                                size = "small",
                                            )
                                        }
                                    },
                            )
                        }
                    }
                }
                items(state.albums, key = { "album-${it.id}" }) { album ->
                    var menuExpanded by remember { mutableStateOf(false) }
                    Box {
                        MediaRow(
                            title = album.name,
                            subtitle = album.artist,
                            coverModel = inlineCoverModel(album.coverArtData)
                                ?: state.serverUrl?.let {
                                    coverArtUrl(serverUrl = it, coverArtId = album.id, size = "small")
                                },
                            onClick = { onOpenAlbum(album.id) },
                            onLongClick = { menuExpanded = true },
                            trailing = {
                                IconButton(onClick = { viewModel.playAlbum(album) }) {
                                    Icon(
                                        Icons.Filled.PlayArrow,
                                        contentDescription = "Play",
                                        modifier = Modifier.size(24.dp),
                                    )
                                }
                            },
                        )
                        CollectionActionSheet(
                            expanded = menuExpanded,
                            onDismiss = { menuExpanded = false },
                            target = CollectionTarget(
                                sourceType = CollectionSource.ALBUM,
                                sourceId = album.id,
                                name = album.name,
                            ),
                            title = album.name,
                            subtitle = album.artist,
                            coverModel = inlineCoverModel(album.coverArtData)
                                ?: state.serverUrl?.let {
                                    coverArtUrl(serverUrl = it, coverArtId = album.id, size = "small")
                                },
                        )
                    }
                }
                items(state.songs, key = { "song-${it.id}" }) { song ->
                    val flags = rememberSongFlags(
                        songId = song.id,
                        starred = song.starred != null,
                    )
                    var menuExpanded by remember { mutableStateOf(false) }
                    Box {
                        MediaRow(
                            title = song.title,
                            subtitle = song.artist,
                            coverModel = inlineCoverModel(song.coverArtData),
                            onClick = { song.albumId?.let(onOpenAlbum) },
                            onLongClick = { menuExpanded = true },
                            trailing = {
                                IconButton(onClick = { viewModel.playSong(song) }) {
                                    Icon(
                                        Icons.Filled.PlayArrow,
                                        contentDescription = "Play",
                                        modifier = Modifier.size(24.dp),
                                    )
                                }
                            },
                        )
                        SongActionSheet(
                            expanded = menuExpanded,
                            onDismiss = { menuExpanded = false },
                            songId = song.id,
                            flags = flags,
                            title = song.title,
                            subtitle = song.artist,
                            coverModel = inlineCoverModel(song.coverArtData),
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
