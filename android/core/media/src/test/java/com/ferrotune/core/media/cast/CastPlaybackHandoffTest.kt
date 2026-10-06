package com.ferrotune.core.media.cast

import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.media.TrackInfo
import com.ferrotune.core.network.dto.SessionCommandRequest
import com.ferrotune.core.network.dto.SessionHeartbeatRequest
import com.ferrotune.core.network.generated.SessionSuccessResponse
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeCastSession
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.TEST_CLIENT_ID
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CastPlaybackHandoffTest {

    private class FakePlayback(initial: PlaybackState) : CastHandoffPlayback {
        override val state = MutableStateFlow(initial)
        var paused = false
        var resyncs = 0
        var items: List<CastMediaItem> = emptyList()

        override suspend fun pauseLocal() {
            paused = true
        }

        override suspend fun castMediaItems() = items

        override suspend fun resyncFromServer() {
            resyncs++
        }
    }

    private class FakeSessionApi : FakeFerrotuneApi() {
        val commands = mutableListOf<SessionCommandRequest>()
        val heartbeats = mutableListOf<SessionHeartbeatRequest>()

        override suspend fun sessionCommand(sessionId: String, request: SessionCommandRequest): SessionSuccessResponse {
            commands += request
            return SessionSuccessResponse(success = true)
        }

        override suspend fun sessionHeartbeat(sessionId: String, request: SessionHeartbeatRequest): SessionSuccessResponse {
            heartbeats += request
            return SessionSuccessResponse(success = true)
        }
    }

    private fun item(songId: String, position: Int) = CastMediaItem(
        songId = songId,
        url = "http://server/api/stream?id=$songId",
        contentType = "audio/ogg",
        title = "Song $songId",
        artist = "Artist",
        album = null,
        coverArtUrl = null,
        durationMs = 200_000,
        position = position,
    )

    private fun track(id: String) = TrackInfo(
        id = id,
        url = "u",
        title = "Song $id",
        artist = "Artist",
        album = "Album",
        coverArtUrl = null,
        durationMs = 200_000,
    )

    private val phonePlaying = PlaybackState(
        sessionId = "session-1",
        queueIndex = 12,
        positionMs = 30_000,
        track = track("b"),
        repeatMode = "off",
    )

    private class Harness(scope: TestScope, local: PlaybackState) {
        val cast = FakeCastSession()
        val playback = FakePlayback(local)
        val api = FakeSessionApi()
        val handoff = CastPlaybackHandoff(
            cast,
            playback,
            FakeApiProvider(api),
            FakeAccounts(),
            UnconfinedTestDispatcher(scope.testScheduler),
            heartbeatIntervalMs = 5_000,
        ).also { it.start() }
    }

    private val receiver = castClientId(TEST_CLIENT_ID)

    @Test
    fun `connecting pauses the phone, claims the session for the receiver, and loads the queue at the current entry`() = runTest {
        val harness = Harness(this, phonePlaying)
        // "b" appears twice; the queue position picks the right entry.
        harness.playback.items = listOf(item("a", 10), item("b", 11), item("b", 12), item("c", 13))
        try {
            harness.cast.connect()
            advanceTimeBy(2_000)

            assertTrue(harness.playback.paused)
            val claim = harness.api.commands.single()
            assertEquals("takeOver", claim.action)
            assertEquals(receiver, claim.clientId)
            assertEquals(CAST_CLIENT_NAME, claim.clientName)
            assertEquals(30_000L, claim.positionMs)
            assertEquals(12, claim.currentIndex)
            assertEquals(2, harness.cast.loads.single().second)
        } finally {
            harness.handoff.stop()
        }
    }

    @Test
    fun `a resumed session that is already playing is adopted, not reloaded`() = runTest {
        val harness = Harness(this, phonePlaying)
        harness.playback.items = listOf(item("b", 12))
        try {
            harness.cast.status.value = CastMediaStatus(isPlaying = true, positionMs = 90_000, songId = "e", queuePosition = 15)
            harness.cast.connect()
            runCurrent()

            val claim = harness.api.commands.single()
            assertEquals(90_000L, claim.positionMs)
            assertEquals(15, claim.currentIndex)
            assertTrue(harness.cast.loads.isEmpty())
        } finally {
            harness.handoff.stop()
        }
    }

    @Test
    fun `the receiver's progress is heartbeated while casting`() = runTest {
        val harness = Harness(this, phonePlaying)
        try {
            harness.cast.status.value = CastMediaStatus(isPlaying = true, positionMs = 5_000, songId = "c", queuePosition = 13, title = "Song c")
            harness.cast.connect()
            runCurrent()
            harness.cast.status.value = CastMediaStatus(isPlaying = true, positionMs = 10_000, songId = "c", queuePosition = 13, title = "Song c")
            advanceTimeBy(5_001)

            val last = harness.api.heartbeats.last()
            assertEquals(receiver, last.clientId)
            assertTrue(last.isPlaying)
            assertEquals(13, last.currentIndex)
            assertEquals(10_000L, last.positionMs)
            assertEquals("c", last.currentSongId)
        } finally {
            harness.handoff.stop()
        }
    }

    @Test
    fun `disconnecting hands the session back to the phone, paused where the receiver stopped`() = runTest {
        val harness = Harness(this, phonePlaying)
        try {
            harness.cast.status.value = CastMediaStatus(isPlaying = true, positionMs = 42_000, songId = "d", queuePosition = 14)
            harness.cast.connect()
            runCurrent()
            harness.cast.disconnect()
            runCurrent()

            val finalBeat = harness.api.heartbeats.last()
            assertEquals(receiver, finalBeat.clientId)
            assertFalse(finalBeat.isPlaying)
            val handBack = harness.api.commands.last()
            assertEquals(TEST_CLIENT_ID, handBack.clientId)
            assertEquals(false, handBack.resumePlayback)
            assertEquals(42_000L, handBack.positionMs)
            assertEquals(14, handBack.currentIndex)
            assertEquals(1, harness.playback.resyncs)
        } finally {
            harness.handoff.stop()
        }
    }

    @Test
    fun `the app starting while not casting changes nothing`() = runTest {
        val harness = Harness(this, phonePlaying)
        try {
            runCurrent()
            assertTrue(harness.api.commands.isEmpty())
            assertEquals(0, harness.playback.resyncs)
            assertFalse(harness.playback.paused)
        } finally {
            harness.handoff.stop()
        }
    }
}
