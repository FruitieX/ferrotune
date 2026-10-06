package com.ferrotune.core.media

import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.SessionCommandRequest
import javax.inject.Inject
import javax.inject.Singleton

/** Another client owns the shared session, so transport controls act on it (web `isRemoteControlling`). */
val PlaybackState.isFollowing: Boolean
    get() = sessionId != null && !ownsSession && sessionOwnerClientId != null

/**
 * Web remote control: while another client owns the session, play, pause,
 * skip, and seek are session commands the server relays to the owner instead
 * of local playback (which would take the session over).
 */
@Singleton
class SessionRemoteControl @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val accounts: Accounts,
) {
    suspend fun play(sessionId: String) = send(sessionId, "play")

    suspend fun pause(sessionId: String) = send(sessionId, "pause")

    suspend fun next(sessionId: String) = send(sessionId, "next")

    suspend fun previous(sessionId: String) = send(sessionId, "previous")

    suspend fun seek(sessionId: String, positionMs: Long) = send(sessionId, "seek", positionMs)

    private suspend fun send(sessionId: String, action: String, positionMs: Long? = null) {
        apiCall {
            apiProvider.requireApi().sessionCommand(
                sessionId,
                SessionCommandRequest(
                    action = action,
                    positionMs = positionMs,
                    clientName = CLIENT_NAME,
                    clientId = accounts.clientId(),
                ),
            )
        }
    }

    private companion object {
        const val CLIENT_NAME = "ferrotune-mobile"
    }
}
