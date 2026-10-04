package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.PeriodReview
import com.ferrotune.core.network.generated.TopAlbum
import com.ferrotune.core.network.generated.TopArtist
import com.ferrotune.core.network.generated.TopTrack
import com.ferrotune.core.network.readableMessage
import com.ferrotune.feature.home.data.HomeRepository
import com.ferrotune.feature.playlists.data.PlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.text.DateFormatSymbols
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One review period: a whole year (`month == null`) or a single month. */
data class ReviewPeriod(val year: Int, val month: Int? = null)

data class ReviewUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val review: PeriodReview? = null,
    /** Years newest first, then months newest first (the web dropdown order). */
    val periods: List<ReviewPeriod> = emptyList(),
) {
    val current: ReviewPeriod? get() = review?.let { ReviewPeriod(it.year, it.month) }

    private val currentIndex: Int get() = periods.indexOf(current)

    /** Older period (the web's ‹ button), or null at the oldest. */
    val previous: ReviewPeriod? get() = currentIndex.takeIf { it >= 0 }?.let { periods.getOrNull(it + 1) }

    /** Newer period (the web's › button), or null at the newest. */
    val next: ReviewPeriod? get() = currentIndex.takeIf { it > 0 }?.let { periods.getOrNull(it - 1) }
}

/** Web "Your Review": period navigation, overview totals, and top tracks/artists/albums. */
@HiltViewModel
class ReviewViewModel @Inject constructor(
    private val repository: HomeRepository,
    private val playbackStarter: PlaybackStarter,
    private val playlistRepository: PlaylistRepository,
    private val messages: UserMessages,
) : ViewModel() {

    private val state = MutableStateFlow(ReviewUiState())
    val uiState: StateFlow<ReviewUiState> = state.asStateFlow()

    private var loadJob: Job? = null

    init {
        select(null)
    }

    /** Loads [period], or the server's default (the current year) for null. */
    fun select(period: ReviewPeriod?) {
        loadJob?.cancel()
        state.update { it.copy(loading = true, error = null) }
        loadJob = viewModelScope.launch {
            runCatching { repository.periodReview(period?.year, period?.month) }
                .onSuccess { response ->
                    state.update {
                        it.copy(loading = false, review = response.review, periods = sortedPeriods(response.availablePeriods))
                    }
                }
                .onFailure { e ->
                    state.update { it.copy(loading = false, error = e.readableMessage() ?: "Couldn't load your review") }
                }
        }
    }

    fun retry() = select(state.value.current)

    /** Plays the period's top tracks in rank order, starting at [track] (web `handlePlayTrack`). */
    fun playTrack(track: TopTrack) {
        val review = state.value.review ?: return
        val ids = review.topTracks.map { it.trackId }
        play(
            QueueStartSpec(
                sourceType = "history",
                sourceName = topTracksName(review),
                songIds = ids,
                startIndex = ids.indexOf(track.trackId).coerceAtLeast(0),
                startSongId = track.trackId,
            ),
            track.trackTitle,
        )
    }

    fun playArtist(artist: TopArtist) =
        play(QueueStartSpec(sourceType = "artist", sourceId = artist.artistId, sourceName = artist.artistName), artist.artistName)

    fun playAlbum(album: TopAlbum) =
        play(QueueStartSpec(sourceType = "album", sourceId = album.albumId, sourceName = album.albumName), album.albumName)

    /** Saves the top tracks as a playlist named like the web's ("Top Tracks - March 2026"). */
    fun createPlaylist() {
        val review = state.value.review ?: return
        if (review.topTracks.isEmpty()) return
        val name = topTracksName(review)
        viewModelScope.launch {
            runCatching { playlistRepository.createPlaylist(name = name, songIds = review.topTracks.map { it.trackId }) }
                .onSuccess { messages.show("Created playlist \"$name\"") }
                .onFailure { messages.failure("Couldn't create the playlist", it) }
        }
    }

    private fun play(spec: QueueStartSpec, title: String) {
        viewModelScope.launch {
            runCatching { playbackStarter.startQueue(spec) }
                .onSuccess { messages.show("Playing \"$title\"") }
                .onFailure { messages.failure("Couldn't start playback", it) }
        }
    }
}

internal fun sortedPeriods(periods: List<AvailablePeriod>): List<ReviewPeriod> {
    val years = periods.filter { it.month == null }.sortedByDescending { it.year }
    val months = periods.filter { it.month != null }.sortedWith(compareByDescending<AvailablePeriod> { it.year }.thenByDescending { it.month })
    return (years + months).map { ReviewPeriod(it.year, it.month) }
}

internal fun monthName(month: Int, locale: Locale = Locale.getDefault()): String =
    DateFormatSymbols.getInstance(locale).months.getOrNull(month - 1).orEmpty()

/** "March 2026" or "2026". */
internal fun periodName(period: ReviewPeriod, locale: Locale = Locale.getDefault()): String =
    period.month?.let { "${monthName(it, locale)} ${period.year}" } ?: period.year.toString()

/** Header label: "March 2026" or "2026 Year in Review". */
internal fun periodLabel(period: ReviewPeriod, locale: Locale = Locale.getDefault()): String =
    if (period.month != null) periodName(period, locale) else "${period.year} Year in Review"

internal fun topTracksName(review: PeriodReview, locale: Locale = Locale.getDefault()): String =
    "Top Tracks - ${periodName(ReviewPeriod(review.year, review.month), locale)}"
