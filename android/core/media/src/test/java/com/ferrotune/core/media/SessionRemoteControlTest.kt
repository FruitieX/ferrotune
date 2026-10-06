package com.ferrotune.core.media

import com.ferrotune.core.network.dto.SessionCommandRequest
import com.ferrotune.core.network.generated.SessionSuccessResponse
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.TEST_CLIENT_ID
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionRemoteControlTest {

    private class FakeSessionApi : FakeFerrotuneApi() {
        val commands = mutableListOf<Pair<String, SessionCommandRequest>>()

        override suspend fun sessionCommand(sessionId: String, request: SessionCommandRequest): SessionSuccessResponse {
            commands += sessionId to request
            return SessionSuccessResponse(success = true)
        }
    }

    @Test
    fun `transport commands are relayed to the session owner as this client`() = runTest {
        val api = FakeSessionApi()
        val remote = SessionRemoteControl(FakeApiProvider(api), FakeAccounts())

        remote.play("session-1")
        remote.pause("session-1")
        remote.next("session-1")
        remote.previous("session-1")
        remote.seek("session-1", 42_000)

        assertEquals(listOf("play", "pause", "next", "previous", "seek"), api.commands.map { it.second.action })
        assertTrue(api.commands.all { it.first == "session-1" && it.second.clientId == TEST_CLIENT_ID })
        assertEquals(42_000L, api.commands.last().second.positionMs)
    }

    @Test
    fun `following means another client owns the session`() {
        val following = PlaybackState(sessionId = "s", ownsSession = false, sessionOwnerClientId = "desktop")
        assertTrue(following.isFollowing)
        // Nobody owns it (cleared after a long pause): local controls apply.
        assertFalse(following.copy(sessionOwnerClientId = null).isFollowing)
        assertFalse(following.copy(ownsSession = true).isFollowing)
        assertFalse(following.copy(sessionId = null).isFollowing)
    }
}
