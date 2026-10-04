package com.ferrotune.core.actions

import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.itemKey
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.TrackGroupHeader
import com.ferrotune.core.network.generated.SongResponse

/**
 * Paged song rows plus their loading, error, empty, and append states, for
 * lists that put a header in front of the songs. Every song list in the app
 * renders through this so rows, highlighting, and gestures stay identical.
 *
 * [index] supplies the number shown in the index column (track number for
 * albums, position elsewhere); return null to hide it. [onPlay] receives the
 * song and its position in the list so screens can start a source queue at
 * that song.
 */
fun LazyListScope.songPagingItems(
    songs: LazyPagingItems<SongResponse>,
    nowPlaying: NowPlaying,
    menu: SongMenuState,
    onPlay: (song: SongResponse, position: Int) -> Unit,
    emptyMessage: String,
    selection: SongSelectionState? = null,
    emptyIcon: ImageVector = Icons.Filled.MusicNote,
    emptyDescription: String? = null,
    index: ((SongResponse, Int) -> Int?)? = { _, position -> position + 1 },
    showCover: Boolean = true,
    subtitle: (SongResponse) -> String? = { songSubtitle(it) },
    key: ((SongResponse) -> Any)? = { it.id },
    groupHeader: ((song: SongResponse, previous: SongResponse?) -> String?)? = null,
) {
    val refresh = songs.loadState.refresh
    when {
        refresh is LoadState.Error && songs.itemCount == 0 -> item(key = "songs-error") {
            ErrorState(
                message = refresh.error.message ?: "Failed to load songs",
                onRetry = songs::retry,
            )
        }

        refresh is LoadState.Loading && songs.itemCount == 0 -> item(key = "songs-loading") {
            MediaRowSkeletonList(count = 8)
        }

        songs.itemCount == 0 -> item(key = "songs-empty") {
            EmptyState(message = emptyMessage, icon = emptyIcon, description = emptyDescription)
        }

        else -> {
            items(
                count = songs.itemCount,
                key = key?.let { songs.itemKey(it) },
                contentType = { "song" },
            ) { position ->
                val song = songs[position] ?: return@items
                groupHeader?.invoke(song, if (position > 0) songs.peek(position - 1) else null)?.let {
                    TrackGroupHeader(it)
                }
                SongListRow(
                    song = song,
                    nowPlaying = nowPlaying,
                    menu = menu,
                    onPlay = { onPlay(song, position) },
                    index = index?.invoke(song, position),
                    showIndexColumn = index != null,
                    showCover = showCover,
                    subtitle = subtitle(song),
                    selection = selection,
                )
            }
            item(key = "songs-footer") {
                PagingListFooter(isLoading = songs.loadState.append is LoadState.Loading)
            }
        }
    }
}

/** Web album "Disc N" separators: shown when an album has more than one disc. */
fun discHeader(song: SongResponse, previous: SongResponse?): String? {
    val disc = song.discNumber ?: return null
    return when {
        previous == null -> if (disc > 1) "Disc $disc" else null
        previous.discNumber != disc -> "Disc $disc"
        else -> null
    }
}
