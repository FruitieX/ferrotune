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
 * Receives push wake-ups: another device handed playback to this app while
 * it was idle. Reattaches to the session and starts playing, the same as a
 * connected app does on the OwnerChanged event.
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
        if (data["type"] != TAKE_OVER) return
        // Work inside the handler: once it returns, the high-priority push's
        // permission to start playback from the background soon lapses.
        runBlocking {
            withTimeoutOrNull(TAKE_OVER_TIMEOUT_MS) {
                withContext(Dispatchers.Main) {
                    runCatching { playbackStarter.restoreSession() }
                    val sessionId = playbackStarter.state.value.sessionId
                    if (sessionId == null || sessionId != data["sessionId"]) {
                        // Pushed for an account that is not the active one.
                        Log.w(TAG, "Ignoring take-over push for another session")
                        return@withContext
                    }
                    playback.applyRemoteTakeOver(
                        positionMs = data["positionMs"]?.toLongOrNull(),
                        resumePlayback = data["resumePlayback"].toBoolean(),
                    )
                }
            }
        }
    }

    private companion object {
        const val TAG = "FerrotunePushService"
        const val TAKE_OVER = "takeOver"
        const val TAKE_OVER_TIMEOUT_MS = 15_000L
    }
}
