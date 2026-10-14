package com.ferrotune.feature.library.ui

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.background
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.LoadState
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.insertSeparators
import androidx.paging.map
import com.ferrotune.core.actions.CoverSize
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.actions.rememberNowPlaying
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.actions.songSubtitle
import com.ferrotune.core.actions.toMenuTarget
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRowSkeletonList
import com.ferrotune.core.designsystem.components.PageIconHeader
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.designsystem.components.TrackGroupHeader
import com.ferrotune.core.designsystem.components.TrackRow
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.ManagedHistoryEntry
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.core.network.readableMessage
import com.ferrotune.feature.library.data.ListeningActivityPagingSource
import com.ferrotune.feature.library.data.activityDayLabel
import com.ferrotune.feature.library.data.activityDetails
import com.ferrotune.feature.library.data.activityTime
import com.ferrotune.feature.library.data.parseEventAt
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** A row of the activity list: a day heading or a play. */
sealed interface ActivityItem {
    data class Day(val label: String) : ActivityItem
    data class Play(val entry: ManagedHistoryEntry, val eventAtMs: Long?) : ActivityItem
}

@HiltViewModel
class ListeningActivityViewModel @Inject constructor(
    apiProvider: FerrotuneApiProvider,
) : ViewModel() {
    val items: Flow<PagingData<ActivityItem>> = Pager(
        config = PagingConfig(pageSize = DEFAULT_PAGE_SIZE, enablePlaceholders = false),
        pagingSourceFactory = { ListeningActivityPagingSource(apiProvider) },
    ).flow
        .map { page ->
            page
                .map<ManagedHistoryEntry, ActivityItem> { ActivityItem.Play(it, parseEventAt(it.eventAt)) }
                .insertSeparators { before, after ->
                    val next = (after as? ActivityItem.Play)?.eventAtMs ?: return@insertSeparators null
                    val previous = (before as? ActivityItem.Play)?.eventAtMs
                    val label = activityDayLabel(next)
                    if (previous == null || activityDayLabel(previous) != label) ActivityItem.Day(label) else null
                }
        }
        .cachedIn(viewModelScope)
}

/**
 * Recent listening, one row per play (web "Manage listening history" with
 * plays combined): when, how much was heard, and whether it was scrobbled.
 * Tap plays the song; long-press opens the song menu.
 */
@Composable
fun ListeningActivityScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ListeningActivityViewModel = hiltViewModel(),
) {
    val items = viewModel.items.collectAsLazyPagingItems()
    val actions: SongActionsViewModel = hiltViewModel()
    val songMenu = rememberSongMenuState()
    val nowPlaying = rememberNowPlaying()
    val timePattern = if (DateFormat.is24HourFormat(LocalContext.current)) "HH:mm" else "h:mm a"

    Column(modifier = modifier.fillMaxSize()) {
        PageIconHeader(
            icon = Icons.Filled.History,
            title = "Listening activity",
            subtitle = "Your recent plays",
            onBack = onBack,
            modifier = Modifier.background(MaterialTheme.colorScheme.background),
        )
        HorizontalDivider()
        val refresh = items.loadState.refresh
        when {
            refresh is LoadState.Loading && items.itemCount == 0 -> MediaRowSkeletonList(count = 10)
            refresh is LoadState.Error && items.itemCount == 0 ->
                ErrorState(
                    message = refresh.error.readableMessage() ?: "Couldn't load listening activity",
                    onRetry = items::retry,
                )
            refresh is LoadState.NotLoading && items.itemCount == 0 ->
                EmptyState(
                    message = "No listening activity yet",
                    icon = Icons.Filled.History,
                    description = "Songs you play show up here.",
                )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                items(
                    count = items.itemCount,
                    key = { index ->
                        when (val item = items.peek(index)) {
                            is ActivityItem.Day -> "day-${item.label}"
                            is ActivityItem.Play -> "${item.entry.kind}-${item.entry.id}"
                            null -> "placeholder-$index"
                        }
                    },
                ) { index ->
                    when (val item = items[index]) {
                        is ActivityItem.Day -> TrackGroupHeader(item.label)
                        is ActivityItem.Play -> {
                            val song = item.entry.song
                            TrackRow(
                                title = song.title,
                                subtitle = songSubtitle(song),
                                details = activityDetails(item.entry),
                                coverModel = coverModel(song.coverArtData, song.coverArt, CoverSize.SMALL),
                                coverSeed = song.album ?: song.title,
                                duration = item.eventAtMs?.let { activityTime(it, timePattern) },
                                isCurrent = nowPlaying.songId == song.id,
                                isPlaying = nowPlaying.songId == song.id && nowPlaying.isPlaying,
                                onClick = { actions.playSong(song.id) },
                                onLongClick = { songMenu.open(song.toMenuTarget()) },
                            )
                        }
                        null -> Unit
                    }
                }
                item(key = "footer") { PagingListFooter(isLoading = items.loadState.append is LoadState.Loading) }
            }
        }
    }
    SongMenuSheet(state = songMenu)
}
