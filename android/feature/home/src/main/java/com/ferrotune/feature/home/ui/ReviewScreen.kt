package com.ferrotune.feature.home.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.coverModel
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.PageIconHeader
import com.ferrotune.core.designsystem.components.SectionCard
import com.ferrotune.core.designsystem.components.SegmentedTabs
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.StatTile
import com.ferrotune.core.designsystem.components.formatCount
import com.ferrotune.core.designsystem.components.formatListeningTime
import com.ferrotune.core.network.generated.PeriodReview
import java.text.NumberFormat

private val GOLD = Color(0xFFEAB308)
private val SILVER = Color(0xFF9CA3AF)
private val BRONZE = Color(0xFFD97706)

/**
 * Web "Your Review": period navigation (‹ picker ›), an overview of the
 * period's totals, and ranked top tracks/artists/albums. Tapping a track plays
 * the ranked list from it; tapping an artist/album opens it and its cover
 * plays it.
 */
@Composable
fun ReviewScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ReviewViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val mediaActions = LocalMediaActions.current
    var pickerOpen by rememberSaveable { mutableStateOf(false) }
    var tab by rememberSaveable { mutableIntStateOf(0) }

    Column(modifier = modifier.fillMaxSize()) {
        PageIconHeader(
            icon = Icons.AutoMirrored.Filled.TrendingUp,
            title = "Your Review",
            subtitle = "See your listening highlights",
            onBack = onBack,
            modifier = Modifier.background(MaterialTheme.colorScheme.background),
        )
        PeriodSelector(
            state = state,
            onPrevious = { state.previous?.let(viewModel::select) },
            onNext = { state.next?.let(viewModel::select) },
            onOpenPicker = { pickerOpen = true },
        )
        HorizontalDivider()

        val review = state.review
        if (review == null && state.error != null) {
            ErrorState(message = state.error!!, onRetry = viewModel::retry)
            return@Column
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item(key = "overview") { OverviewCard(review, loading = state.loading) }
            item(key = "top") {
                SectionCard(
                    icon = Icons.Filled.EmojiEvents,
                    title = "Your Top Picks",
                    description = "Most played artists, albums, and tracks",
                ) {
                    if (review != null && review.topTracks.isNotEmpty()) {
                        OutlinedButton(onClick = viewModel::createPlaylist, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.AutoMirrored.Filled.PlaylistAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Create Playlist")
                        }
                    }
                    SegmentedTabs(
                        labels = listOf("Tracks", "Artists", "Albums"),
                        selectedIndex = tab,
                        onSelect = { tab = it },
                    )
                    when {
                        review == null || state.loading -> repeat(5) { RankSkeleton() }
                        tab == 0 -> RankList(review.topTracks, "No track data for this period") { rank, track ->
                            RankRow(
                                rank = rank,
                                title = track.trackTitle,
                                subtitle = listOfNotNull(track.artistName, plays(track.playCount)).joinToString(" • "),
                                cover = coverModel(track.coverArtData, track.coverArt),
                                seed = track.albumId ?: track.trackId,
                                placeholder = Icons.Filled.MusicNote,
                                onClick = { viewModel.playTrack(track) },
                            )
                        }
                        tab == 1 -> RankList(review.topArtists, "No artist data for this period") { rank, artist ->
                            RankRow(
                                rank = rank,
                                title = artist.artistName,
                                subtitle = "${plays(artist.playCount)} • ${formatListeningTime(artist.totalDurationSecs)}",
                                cover = coverModel(artist.coverArtData, artist.coverArt),
                                seed = artist.artistName,
                                placeholder = Icons.Filled.Person,
                                coverShape = CircleShape,
                                onClick = { mediaActions.openArtist(artist.artistId) },
                                onPlay = { viewModel.playArtist(artist) },
                            )
                        }
                        else -> RankList(review.topAlbums, "No album data for this period") { rank, album ->
                            RankRow(
                                rank = rank,
                                title = album.albumName,
                                subtitle = listOfNotNull(album.artistName, plays(album.playCount)).joinToString(" • "),
                                cover = coverModel(album.coverArtData, album.coverArt),
                                seed = album.albumId,
                                placeholder = Icons.Filled.Album,
                                onClick = { mediaActions.openAlbum(album.albumId) },
                                onPlay = { viewModel.playAlbum(album) },
                            )
                        }
                    }
                }
            }
        }
    }

    MediaActionSheet(
        expanded = pickerOpen,
        onDismiss = { pickerOpen = false },
        title = "Choose a period",
        subtitle = "Year in review or a single month",
        placeholder = Icons.Filled.CalendarMonth,
        actions = state.periods.mapIndexed { index, period ->
            MediaAction(
                label = if (period == state.current) "${periodLabel(period)}  ✓" else periodLabel(period),
                icon = if (period.month == null) Icons.Filled.EmojiEvents else Icons.Filled.CalendarMonth,
                separatorBefore = period.month != null && state.periods.getOrNull(index - 1)?.month == null && index > 0,
            ) { viewModel.select(period) }
        },
    )
}

@Composable
private fun PeriodSelector(
    state: ReviewUiState,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onOpenPicker: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious, enabled = state.previous != null) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous period")
        }
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .clickable(enabled = state.periods.isNotEmpty(), onClick = onOpenPicker)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Filled.CalendarMonth, contentDescription = null, modifier = Modifier.size(18.dp))
            Text(
                state.current?.let { periodLabel(it) } ?: "Loading…",
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Filled.ExpandMore, contentDescription = null, modifier = Modifier.size(18.dp))
        }
        IconButton(onClick = onNext, enabled = state.next != null) {
            Icon(Icons.Filled.ChevronRight, contentDescription = "Next period")
        }
    }
}

@Composable
private fun OverviewCard(review: PeriodReview?, loading: Boolean) {
    val numbers = NumberFormat.getIntegerInstance()
    SectionCard(
        icon = Icons.Filled.EmojiEvents,
        title = "Overview",
        description = review?.let { "Your highlights for ${periodName(ReviewPeriod(it.year, it.month))}" }
            ?: "Loading your listening stats…",
        accent = null,
    ) {
        if (review == null || loading) {
            repeat(3) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ShimmerBox(Modifier.weight(1f).height(64.dp))
                    ShimmerBox(Modifier.weight(1f).height(64.dp))
                }
            }
            return@SectionCard
        }
        if (review.totalPlayCount == 0L) {
            Text(
                "No listening data yet. Start playing some music!",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SectionCard
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile("Time listened", formatListeningTime(review.totalListeningSecs), Icons.Filled.Schedule, Modifier.weight(1f))
            StatTile("Total plays", numbers.format(review.totalPlayCount), Icons.AutoMirrored.Filled.TrendingUp, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile("Tracks", numbers.format(review.uniqueTracks), Icons.Filled.MusicNote, Modifier.weight(1f))
            StatTile("Albums", numbers.format(review.uniqueAlbums), Icons.Filled.Album, Modifier.weight(1f))
            StatTile("Artists", numbers.format(review.uniqueArtists), Icons.Filled.Person, Modifier.weight(1f))
        }
    }
}

@Composable
private fun <T> RankList(items: List<T>, emptyMessage: String, row: @Composable (Int, T) -> Unit) {
    if (items.isEmpty()) {
        Text(
            emptyMessage,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEachIndexed { index, item -> row(index + 1, item) }
    }
}

/** Web `TopTrackCard`/`TopArtistCard`/`TopAlbumCard`: rank, cover, text, medal for the top three. */
@Composable
private fun RankRow(
    rank: Int,
    title: String,
    subtitle: String,
    cover: Any?,
    seed: String,
    placeholder: ImageVector,
    onClick: () -> Unit,
    coverShape: Shape = RoundedCornerShape(6.dp),
    onPlay: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            rank.toString(),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(32.dp),
        )
        Box(modifier = Modifier.size(40.dp)) {
            CoverArt(
                model = cover,
                contentDescription = title,
                seed = seed,
                shape = coverShape,
                placeholder = placeholder,
                modifier = Modifier.size(40.dp),
            )
            if (onPlay != null) {
                // The web cover's play button; tapping elsewhere opens the item.
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(coverShape)
                        .background(Color.Black.copy(alpha = 0.35f))
                        .clickable(onClick = onPlay),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = "Play $title", tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        medalColor(rank)?.let { color ->
            Icon(Icons.Filled.EmojiEvents, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun RankSkeleton() {
    Row(
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ShimmerBox(Modifier.size(32.dp))
        ShimmerBox(Modifier.size(40.dp))
        ShimmerBox(Modifier.weight(1f).height(36.dp))
    }
}

private fun medalColor(rank: Int): Color? = when (rank) {
    1 -> GOLD
    2 -> SILVER
    3 -> BRONZE
    else -> null
}

private fun plays(count: Long): String = formatCount(count.toInt(), "play")
