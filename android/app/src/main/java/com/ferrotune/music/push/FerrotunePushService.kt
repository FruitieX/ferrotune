package com.ferrotune.music.push

import android.util.Log
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.media.NativeAudioLogger
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Receives push wake-ups while this app is idle with its session stream
 * closed: another device handed playback to it (`takeOver`, handled like the
 * OwnerChanged event) or sent it, the session owner, a command such as play
 * or seek (handled like the PlaybackCommand event); both reattach to the
 * session first. A `diagnostics` push uploads the app's logs without touching
 * playback.
 */
@AndroidEntryPoint
class FerrotunePushService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushRegistrar

    @Inject lateinit var playbackStarter: PlaybackStarter

    @Inject lateinit var playback: PlaybackRepository

    @Inject lateinit var apiProvider: FerrotuneApiProvider

    @Inject lateinit var accounts: Accounts

    override fun onNewToken(token: String) {
        runBlocking { registrar.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"]
        if (type == DIAGNOSTICS) {
            uploadDiagnostics(data)
            return
        }
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

    /**
     * Uploads the logs a diagnostics pull asked for. Runs inside the handler,
     * which keeps the process awake until it returns; gzipped logs are a few
     * hundred kilobytes, so this takes seconds even on mobile data.
     */
    private fun uploadDiagnostics(data: Map<String, String>) {
        val requestId = data["requestId"] ?: return
        val sessionId = data["sessionId"] ?: return
        NativeAudioLogger.initialize(applicationContext)
        NativeAudioLogger.info(
            TAG,
            "diagnostics_request_received",
            "Diagnostics request received by push",
            mapOf("requestId" to requestId),
        )
        val uploaded = runBlocking {
            withTimeoutOrNull(DIAGNOSTICS_TIMEOUT_MS) {
                runCatching {
                    val api = apiProvider.requireApi()
                    val bundle = withContext(Dispatchers.IO) {
                        NativeAudioLogger.gzippedDiagnosticsPayload(
                            requestId,
                            accounts.clientId(),
                            data["maxBytes"]?.toLongOrNull(),
                        )
                    }
                    apiCall {
                        api.uploadDiagnostics(sessionId, requestId, bundle.toRequestBody(JSON_MEDIA_TYPE))
                    }
                }.onFailure { exception -> Log.w(TAG, "Diagnostics upload failed", exception) }.isSuccess
            } ?: false
        }
        if (uploaded) {
            NativeAudioLogger.info(TAG, "diagnostics_uploaded", "Diagnostics uploaded to server", mapOf("requestId" to requestId))
        } else {
            NativeAudioLogger.warn(TAG, "diagnostics_upload_failed", "Diagnostics upload failed", mapOf("requestId" to requestId))
        }
    }

    private companion object {
        const val TAG = "FerrotunePushService"
        const val TAKE_OVER = "takeOver"
        const val COMMAND = "command"
        const val DIAGNOSTICS = "diagnostics"
        const val PUSH_TIMEOUT_MS = 15_000L
        const val DIAGNOSTICS_TIMEOUT_MS = 30_000L
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
