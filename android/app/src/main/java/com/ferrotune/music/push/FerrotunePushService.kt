package com.ferrotune.music.push

import android.util.Log
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackStarter
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Receives push wake-ups while this app is idle with its session stream
 * closed: another device handed playback to it (`takeOver`, handled like the
 * OwnerChanged event) or sent it, the session owner, a command such as play
 * or seek (handled like the PlaybackCommand event). Reattaches to the session
 * first.
 */
@AndroidEntryPoint
class FerrotunePushService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushRegistrar

    @Inject lateinit var playbackStarter: PlaybackStarter

    @Inject lateinit var playback: PlaybackRepository

    override fun onNewToken(token: String) {
        runBlocking { registrar.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"]
        if (type != TAKE_OVER && type != COMMAND) return
        // Work inside the handler: once it returns, the high-priority push's
        // permission to start playback from the background soon lapses.
        runBlocking {
            withTimeoutOrNull(PUSH_TIMEOUT_MS) {
                withContext(Dispatchers.Main) {
                    runCatching { playbackStarter.restoreSession() }
                    val sessionId = playbackStarter.state.value.sessionId
                    if (sessionId == null || sessionId != data["sessionId"]) {
                        // Pushed for an account that is not the active one.
                        Log.w(TAG, "Ignoring $type push for another session")
                        return@withContext
                    }
                    val positionMs = data["positionMs"]?.toLongOrNull()
                    if (type == TAKE_OVER) {
                        playback.applyRemoteTakeOver(
                            positionMs = positionMs,
                            resumePlayback = data["resumePlayback"].toBoolean(),
                        )
                    } else {
                        val action = data["action"] ?: return@withContext
                        playback.applyRemoteCommand(action, positionMs, data["currentIndex"]?.toIntOrNull())
                    }
                }
            }
        }
    }

    private companion object {
        const val TAG = "FerrotunePushService"
        const val TAKE_OVER = "takeOver"
        const val COMMAND = "command"
        const val PUSH_TIMEOUT_MS = 15_000L
    }
}
