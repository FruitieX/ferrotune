package com.ferrotune.feature.home.ui

import com.ferrotune.core.actions.UserMessage
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.ImportPlaylistRequest
import com.ferrotune.core.network.generated.ImportPlaylistResponse
import com.ferrotune.core.network.generated.PeriodReviewResponse
import com.ferrotune.core.network.generated.TopTrack
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.home.data.HomeRepository
import com.ferrotune.feature.playlists.data.PlaylistRepository
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun track(id: String) = TopTrack(trackId = id, trackTitle = "Track $id", playCount = 3, totalDurationSecs = 300)

    private fun reviewWithTracks(): PeriodReviewResponse = testReviewResponse().let {
        it.copy(review = it.review.copy(month = 3, topTracks = listOf(track("a"), track("b"), track("c"))))
    }

    private class Harness(review: PeriodReviewResponse = testReviewResponse()) {
        val api = FakeHomeApiWithImport(review)
        val starter = FakePlaybackStarter()
        val messages = UserMessages()
        val received = mutableListOf<UserMessage>()

        init {
            CoroutineScope(UnconfinedTestDispatcher()).launch { messages.messages.collect { received += it } }
        }

        val viewModel = ReviewViewModel(
            HomeRepository(FakeApiProvider(api)),
            starter,
            PlaylistRepository(FakeApiProvider(api)),
            messages,
        )
    }

    private class FakeHomeApiWithImport(review: PeriodReviewResponse) : FakeHomeApi(review = review) {
        var imported: ImportPlaylistRequest? = null

        override suspend fun importPlaylist(request: ImportPlaylistRequest): ImportPlaylistResponse {
            imported = request
            return ImportPlaylistResponse(playlistId = "pl-1", matchedCount = request.entries.size, missingCount = 0)
        }
    }

    @Test
    fun `load populates review and periods`() {
        val harness = Harness()

        val state = harness.viewModel.uiState.value
        assertEquals(2026, state.review?.year)
        assertEquals(listOf(ReviewPeriod(2026), ReviewPeriod(2026, 1)), state.periods)
        assertEquals("medium", harness.api.reviewParams?.get("inlineImages"))
    }

    @Test
    fun `selecting a period forwards year and month`() {
        val harness = Harness()

        harness.viewModel.select(ReviewPeriod(2026, 3))

        assertEquals("2026", harness.api.reviewParams?.get("year"))
        assertEquals("3", harness.api.reviewParams?.get("month"))
    }

    @Test
    fun `periods sort years then months, newest first, and navigate like the web arrows`() {
        val periods = sortedPeriods(
            listOf(
                AvailablePeriod(2025, null, true),
                AvailablePeriod(2026, 1, true),
                AvailablePeriod(2026, null, true),
                AvailablePeriod(2025, 12, true),
                AvailablePeriod(2026, 2, true),
            ),
        )
        assertEquals(
            listOf(ReviewPeriod(2026), ReviewPeriod(2025), ReviewPeriod(2026, 2), ReviewPeriod(2026, 1), ReviewPeriod(2025, 12)),
            periods,
        )

        val review = testReviewResponse().review
        val atYear = ReviewUiState(review = review.copy(month = null), periods = periods)
        assertNull(atYear.next)
        assertEquals(ReviewPeriod(2025), atYear.previous)
        val atJanuary = ReviewUiState(review = review.copy(month = 1), periods = periods)
        assertEquals(ReviewPeriod(2026, 2), atJanuary.next)
        assertEquals(ReviewPeriod(2025, 12), atJanuary.previous)
    }

    @Test
    fun `playing a top track queues the ranked list from that track`() {
        val harness = Harness(reviewWithTracks())

        harness.viewModel.playTrack(track("b"))

        val spec = harness.starter.specs.single()
        assertEquals("history", spec.sourceType)
        assertEquals(listOf("a", "b", "c"), spec.songIds)
        assertEquals(1, spec.startIndex)
        assertEquals("b", spec.startSongId)
        assertEquals("Playing \"Track b\"", harness.received.single().text)
    }

    @Test
    fun `create playlist saves the top tracks with the web's name`() {
        val harness = Harness(reviewWithTracks())

        harness.viewModel.createPlaylist()

        val request = harness.api.imported!!
        assertEquals(topTracksName(harness.viewModel.uiState.value.review!!), request.name)
        assertEquals(listOf("a", "b", "c"), request.entries.map { it.songId })
        assertEquals("Created playlist \"${request.name}\"", harness.received.single().text)
    }

    @Test
    fun `period labels match the web`() {
        assertEquals("2026 Year in Review", periodLabel(ReviewPeriod(2026), Locale.US))
        assertEquals("March 2026", periodLabel(ReviewPeriod(2026, 3), Locale.US))
    }
}
