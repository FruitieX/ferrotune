package com.ferrotune.feature.home.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaRow
import com.ferrotune.core.designsystem.components.formatListeningTime
import com.ferrotune.core.network.coverArtUrl
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.TopAlbum
import com.ferrotune.core.network.generated.TopArtist
import com.ferrotune.core.network.generated.TopTrack

@Composable
fun ReviewScreen(
    onBack: () -> Unit,
    onOpenArtist: (String) -> Unit,
    onOpenAlbum: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ReviewViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Listening review") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading && state.review == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            state.error != null && state.review == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                ErrorState(
                    message = state.error!!,
                    onRetry = { viewModel.load(state.selectedYear, state.selectedMonth) },
                )
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PeriodChips(
                        periods = state.periods,
                        selectedYear = state.selectedYear,
                        selectedMonth = state.selectedMonth,
                        onSelect = { year, month -> viewModel.load(year, month) },
                    )
                }
                state.review?.let { review ->
                    item {
                        ReviewSummary(
                            totalSeconds = review.totalListeningSecs,
                            playCount = review.totalPlayCount,
                            uniqueTracks = review.uniqueTracks,
                            uniqueAlbums = review.uniqueAlbums,
                            uniqueArtists = review.uniqueArtists,
                        )
                    }
                    if (review.topArtists.isNotEmpty()) {
                        item { SectionTitle("Top artists") }
                        items(review.topArtists, key = { "artist-${it.artistId}" }) { artist ->
                            TopArtistRow(artist, state.serverUrl, onOpenArtist)
                        }
                    }
                    if (review.topAlbums.isNotEmpty()) {
                        item { SectionTitle("Top albums") }
                        items(review.topAlbums, key = { "album-${it.albumId}" }) { album ->
                            TopAlbumRow(album, state.serverUrl, onOpenAlbum)
                        }
                    }
                    if (review.topTracks.isNotEmpty()) {
                        item { SectionTitle("Top tracks") }
                        items(review.topTracks, key = { "track-${it.trackId}" }) { track ->
                            TopTrackRow(track)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PeriodChips(
    periods: List<AvailablePeriod>,
    selectedYear: Int?,
    selectedMonth: Int?,
    onSelect: (Int?, Int?) -> Unit,
) {
    if (periods.isEmpty()) return
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(periods) { period ->
            val selected = period.year == selectedYear && period.month == selectedMonth
            FilterChip(
                selected = selected,
                onClick = { onSelect(period.year, period.month) },
                label = {
                    Text(
                        if (period.month != null) {
                            "%d-%02d".format(period.year, period.month)
                        } else {
                            period.year.toString()
                        }
                    )
                },
            )
        }
    }
}

@Composable
private fun ReviewSummary(
    totalSeconds: Long,
    playCount: Long,
    uniqueTracks: Long,
    uniqueAlbums: Long,
    uniqueArtists: Long,
) {
    Card(modifier = Modifier.padding(horizontal = 16.dp)) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(formatListeningTime(totalSeconds), style = MaterialTheme.typography.headlineSmall)
            Text(
                text = "$playCount plays • $uniqueTracks tracks • $uniqueAlbums albums • " +
                    "$uniqueArtists artists",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TopArtistRow(
    artist: TopArtist,
    serverUrl: String?,
    onOpenArtist: (String) -> Unit,
) {
    MediaRow(
        title = artist.artistName,
        subtitle = "${artist.playCount} plays • ${formatListeningTime(artist.totalDurationSecs)}",
        coverModel = inlineOrUrl(artist.coverArtData, serverUrl, artist.coverArt),
        onClick = { onOpenArtist(artist.artistId) },
    )
}

@Composable
private fun TopAlbumRow(
    album: TopAlbum,
    serverUrl: String?,
    onOpenAlbum: (String) -> Unit,
) {
    MediaRow(
        title = album.albumName,
        subtitle = listOfNotNull(
            album.artistName,
            "${album.playCount} plays",
        ).joinToString(" • "),
        coverModel = inlineOrUrl(album.coverArtData, serverUrl, album.coverArt),
        onClick = { onOpenAlbum(album.albumId) },
    )
}

@Composable
private fun TopTrackRow(track: TopTrack) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverArt(
            model = com.ferrotune.core.designsystem.components.inlineCoverModel(track.coverArtData),
            contentDescription = null,
            modifier = Modifier.size(48.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(track.trackTitle, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(
                text = listOfNotNull(track.artistName, track.albumName).joinToString(" • "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        Text(
            text = "${track.playCount}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun inlineOrUrl(
    coverArtData: String?,
    serverUrl: String?,
    coverArt: String?,
): Any? = com.ferrotune.core.designsystem.components.inlineCoverModel(coverArtData)
    ?: serverUrl?.let { base ->
        coverArt?.let { coverArtUrl(serverUrl = base, coverArtId = it, size = "small") }
    }

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}
