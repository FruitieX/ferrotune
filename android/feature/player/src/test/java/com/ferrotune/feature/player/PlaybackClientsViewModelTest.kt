package com.ferrotune.feature.player

import com.ferrotune.core.actions.UserMessage
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.network.dto.SessionCommandRequest
import com.ferrotune.core.network.generated.ClientListResponse
import com.ferrotune.core.network.generated.ClientResponse
import com.ferrotune.core.network.generated.SessionSuccessResponse
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.core.testing.TEST_CLIENT_ID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackClientsViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeSessionApi : FakeFerrotuneApi() {
        var clients = listOf(
            client("desktop", "ferrotune-web", "Desktop", isOwner = true),
            client(TEST_CLIENT_ID, "ferrotune-mobile", "Pixel"),
        )
        var clientReads = 0
        val commands = mutableListOf<Pair<String, SessionCommandRequest>>()

        override suspend fun sessionClients(): ClientListResponse {
            clientReads++
            return ClientListResponse(clients)
        }

        override suspend fun sessionCommand(sessionId: String, request: SessionCommandRequest): SessionSuccessResponse {
            commands += sessionId to request
            return SessionSuccessResponse(success = true)
        }
    }

    private class Harness(state: PlaybackState) {
        val api = FakeSessionApi()
        val starter = FakePlaybackStarter().apply { this.state.value = state }
        val messages = UserMessages()
        val received = mutableListOf<UserMessage>()
        val viewModel: PlaybackClientsViewModel

        init {
            CoroutineScope(UnconfinedTestDispatcher()).launch { messages.messages.collect { received += it } }
            viewModel = PlaybackClientsViewModel(FakeApiProvider(api), starter, FakeAccounts(), messages)
            viewModel.uiState.launchIn(TestScope(UnconfinedTestDispatcher()))
        }
    }

    private val following = PlaybackState(
        sessionId = "session-1",
        ownsSession = false,
        sessionOwnerClientName = "ferrotune-web",
        sessionOwnerClientId = "desktop",
        status = PlaybackStatus.PAUSED,
        positionMs = 42_000,
    )

    @Test
    fun `following another client shows its display name`() {
        val harness = Harness(following)

        val state = harness.viewModel.uiState.value
        assertTrue(state.isFollowing)
        assertEquals("Desktop", state.ownerDisplayName)
        assertEquals(TEST_CLIENT_ID, state.myClientId)
    }

    @Test
    fun `an unknown owner name still counts as following`() {
        val harness = Harness(following.copy(sessionOwnerClientName = null))

        assertTrue(harness.viewModel.uiState.value.isFollowing)
    }

    @Test
    fun `a cleared owner is not following anyone`() {
        // The server drops the owner after a long pause; nothing plays anywhere.
        val harness = Harness(following.copy(sessionOwnerClientId = null))

        assertFalse(harness.viewModel.uiState.value.isFollowing)
    }

    @Test
    fun `owning the session is not following and skips the client list`() {
        val harness = Harness(
            following.copy(ownsSession = true, sessionOwnerClientName = "ferrotune-mobile", sessionOwnerClientId = TEST_CLIENT_ID),
        )

        assertFalse(harness.viewModel.uiState.value.isFollowing)
        assertEquals(0, harness.api.clientReads)
    }

    @Test
    fun `taking playback back resumes here without overriding the server position`() {
        val harness = Harness(following)
        val me = harness.api.clients.first { it.clientId == TEST_CLIENT_ID }

        harness.viewModel.transferTo(me)

        val (sessionId, request) = harness.api.commands.single()
        assertEquals("session-1", sessionId)
        assertEquals("takeOver", request.action)
        assertEquals(TEST_CLIENT_ID, request.clientId)
        assertEquals("ferrotune-mobile", request.clientName)
        assertEquals(true, request.resumePlayback)
        // A remote control's position is stale; the owner's server-side position wins.
        assertNull(request.positionMs)
        assertEquals("Playing on this phone", harness.received.single().text)
    }

    @Test
    fun `the owner hands off its live position and play state`() {
        val harness = Harness(
            following.copy(ownsSession = true, sessionOwnerClientName = "ferrotune-mobile", status = PlaybackStatus.PLAYING),
        )
        val desktop = client("desktop", "ferrotune-web", "Desktop")

        harness.viewModel.transferTo(desktop)

        val request = harness.api.commands.single().second
        assertEquals(42_000L, request.positionMs)
        assertEquals(true, request.resumePlayback)
        assertEquals("desktop", request.clientId)
        assertEquals("Playing on Desktop", harness.received.single().text)
    }

    @Test
    fun `selecting the current owner does nothing`() {
        val harness = Harness(following)

        harness.viewModel.transferTo(harness.api.clients.first { it.isOwner })

        assertTrue(harness.api.commands.isEmpty())
    }

    @Test
    fun `fallback names cover clients before the list loads`() {
        assertEquals("the web player", friendlyClientName("ferrotune-web"))
        assertEquals("another phone", friendlyClientName("ferrotune-mobile"))
        assertEquals("a Cast device", friendlyClientName("ferrotune-cast"))
    }

    private companion object {
        fun client(id: String, name: String, display: String, isOwner: Boolean = false) = ClientResponse(
            clientId = id,
            clientName = name,
            displayName = display,
            isOwner = isOwner,
        )
    }
}
