package com.ferrotune.core.actions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaActionSeparator
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.TrackRow
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.network.generated.SongResponse
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** The song a [SongMenuSheet] acts on. */
@Immutable
data class SongMenuTarget(
    val id: String,
    val title: String,
    val artist: String,
    val artistId: String?,
    val album: String?,
    val albumId: String?,
    val coverModel: Any?,
    val starred: Boolean,
    val rating: Int,
)

fun SongResponse.toMenuTarget(): SongMenuTarget = SongMenuTarget(
    id = id,
    title = title,
    artist = artist,
    artistId = artistId.takeIf { it.isNotBlank() },
    album = album,
    albumId = albumId,
    coverModel = inlineCoverModel(coverArtData),
    starred = starred != null,
    rating = userRating ?: 0,
)

/**
 * Screen-level holder for the song action sheet. Lists keep one of these and
 * one [SongMenuSheet] instead of composing a sheet inside every row.
 */
@Stable
class SongMenuState {
    var target by mutableStateOf<SongMenuTarget?>(null)
        private set

    /** The song whose "View details" sheet is open (it outlives the menu). */
    var detailsFor by mutableStateOf<SongMenuTarget?>(null)
        private set

    fun open(target: SongMenuTarget) {
        this.target = target
    }

    fun close() {
        target = null
    }

    fun showDetails(target: SongMenuTarget) {
        detailsFor = target
    }

    fun closeDetails() {
        detailsFor = null
    }
}

@Composable
fun rememberSongMenuState(): SongMenuState = remember { SongMenuState() }

/** Which song is loaded in the player and whether it is audibly playing. */
@Immutable
data class NowPlaying(
    val songId: String? = null,
    val isPlaying: Boolean = false,
)

/**
 * The player's current song for list highlighting. Only changes when the
 * track or play state changes, so progress ticks never recompose lists.
 */
@Composable
fun rememberNowPlaying(): NowPlaying {
    val context = LocalContext.current
    val flow = remember(context) {
        songActionsEntryPoint(context).playbackStarter().state
            .map { state ->
                NowPlaying(
                    songId = state.track?.id,
                    isPlaying = state.status == PlaybackStatus.PLAYING ||
                        state.status == PlaybackStatus.BUFFERING,
                )
            }
            .distinctUntilChanged()
    }
    val nowPlaying by flow.collectAsStateWithLifecycle(initialValue = NowPlaying())
    return nowPlaying
}

/**
 * The web song row for a [SongResponse]: tap plays (or toggles selection while
 * selecting), long-press opens [menu] (or toggles selection), and the current
 * track shows the now-playing bars.
 */
@Composable
fun SongListRow(
    song: SongResponse,
    nowPlaying: NowPlaying,
    menu: SongMenuState,
    onPlay: () -> Unit,
    modifier: Modifier = Modifier,
    index: Int? = null,
    showIndexColumn: Boolean = index != null,
    showCover: Boolean = true,
    subtitle: String? = songSubtitle(song),
    selection: SongSelectionState? = null,
    isCurrent: Boolean = nowPlaying.songId == song.id,
    onLongPress: (() -> Unit)? = null,
    disabled: Boolean = song.id in rememberDisabledSongIds(),
) {
    val selecting = selection?.isActive == true
    val selected = selection != null && song.id in selection.selectedIds
    TrackRow(
        title = song.title,
        subtitle = subtitle,
        coverModel = coverModel(song.coverArtData, song.coverArt, CoverSize.SMALL),
        coverSeed = song.album ?: song.title,
        onClick = { if (selecting) selection?.toggle(song.id) else onPlay() },
        onLongClick = {
            if (selecting) {
                selection?.toggle(song.id)
            } else {
                onLongPress?.invoke()
                menu.open(song.toMenuTarget())
            }
        },
        modifier = modifier,
        index = index,
        showIndexColumn = showIndexColumn,
        isCurrent = isCurrent,
        isPlaying = isCurrent && nowPlaying.isPlaying,
        showCover = showCover,
        duration = formatClockDuration(song.duration * 1000),
        selectionActive = selecting,
        selected = selected,
        dimmed = disabled,
        trailing = if (disabled) {
            {
                Icon(
                    Icons.Filled.Block,
                    contentDescription = "Disabled: skipped in automatic playback",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
            }
        } else {
            null
        },
    )
}

/** Web subtitle: "artist • album". */
fun songSubtitle(song: SongResponse, showArtist: Boolean = true, showAlbum: Boolean = true): String =
    listOfNotNull(
        song.artist.takeIf { showArtist && it.isNotBlank() },
        song.album?.takeIf { showAlbum && it.isNotBlank() },
    ).joinToString(" • ")

/**
 * The web song drawer menu: play, queue, radio, playlist, favorite, rating,
 * navigation, download, and selection. [extraActions] adds screen-specific
 * rows (e.g. "Remove from playlist") after the queue/playlist group.
 */
@Composable
fun SongMenuSheet(
    state: SongMenuState,
    onPlay: ((SongMenuTarget) -> Unit)? = null,
    onStartSelection: ((SongMenuTarget) -> Unit)? = null,
    extraActions: (SongMenuTarget) -> List<MediaAction> = { emptyList() },
    viewModel: SongActionsViewModel = hiltViewModel(),
) {
    state.detailsFor?.let { SongDetailsSheet(it, onDismiss = state::closeDetails) }
    val target = state.target ?: return
    val actions = LocalMediaActions.current
    val flags = rememberSongFlags(target.id, target.starred, target.rating)
    val disabled = target.id in rememberDisabledSongIds()
    MediaActionSheet(
        expanded = true,
        onDismiss = state::close,
        title = target.title,
        subtitle = listOfNotNull(target.artist, target.album).joinToString(" • "),
        coverModel = target.coverModel,
        seed = target.album ?: target.title,
        actions = buildList {
            add(
                MediaAction(label = "Play", icon = Icons.Filled.PlayArrow) {
                    onPlay?.invoke(target) ?: viewModel.playSong(target.id)
                },
            )
            add(MediaAction(label = "Play next", icon = Icons.Filled.PlaylistPlay) { viewModel.playNext(listOf(target.id)) })
            add(MediaAction(label = "Add to queue", icon = Icons.Filled.Add) { viewModel.addToQueue(listOf(target.id)) })
            add(MediaAction(label = "Start radio", icon = Icons.Filled.Radio) { actions.openSongRadio(target.id) })
            add(
                MediaAction(label = "Add to playlist", icon = Icons.AutoMirrored.Filled.PlaylistAdd) {
                    actions.addToPlaylist(listOf(target.id))
                },
            )
            addAll(extraActions(target))
            add(
                MediaAction(
                    label = if (flags.starred) "Remove from favorites" else "Add to favorites",
                    icon = if (flags.starred) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    separatorBefore = true,
                ) { viewModel.toggleStar(target.id, flags) },
            )
        },
        extraContent = {
            RatingRow(rating = flags.rating, onRate = { viewModel.setRating(target.id, it) })
            MediaActionSeparator()
            target.artistId?.let { artistId ->
                MediaActionRow(
                    icon = Icons.Filled.Person,
                    label = "Go to artist",
                    onClick = { actions.openArtist(artistId) },
                )
            }
            target.albumId?.let { albumId ->
                MediaActionRow(
                    icon = Icons.Filled.Album,
                    label = "Go to album",
                    onClick = { actions.openAlbum(albumId) },
                )
            }
            MediaActionRow(
                icon = Icons.Outlined.Info,
                label = "View details",
                onClick = { state.showDetails(target) },
            )
            MediaActionSeparator()
            actions.SongDownloadMenuItem(target.id)
            MediaActionRow(
                icon = Icons.Filled.Block,
                label = if (disabled) "Enable track" else "Disable track",
                onClick = { viewModel.setDisabled(listOf(target.id), !disabled) },
            )
            if (onStartSelection != null) {
                MediaActionRow(
                    icon = Icons.Filled.Checklist,
                    label = "Select",
                    onClick = { onStartSelection(target) },
                )
            }
        },
    )
}

/** Inline 1-5 star picker; tapping the current rating clears it (web "Remove rating"). */
@Composable
private fun RatingRow(rating: Int, onRate: (Int) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Star,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            text = "Rate",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        for (star in 1..5) {
            val filled = star <= rating
            Icon(
                imageVector = if (filled) Icons.Filled.Star else Icons.Outlined.StarOutline,
                contentDescription = "Rate $star",
                tint = if (filled) RatingYellow else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(32.dp)
                    .clickable { onRate(if (star == rating) 0 else star) }
                    .padding(4.dp),
            )
        }
    }
}

/** Web `text-yellow-500` for rated stars. */
private val RatingYellow = Color(0xFFEAB308)
