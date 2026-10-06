package com.ferrotune.core.media.cast

import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.media.PlaybackState
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.SessionCommandRequest
import com.ferrotune.core.network.dto.SessionHeartbeatRequest
import com.ferrotune.core.network.dto.UpdateQueuePositionRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Client name the server and every client use for Cast receivers. */
const val CAST_CLIENT_NAME = "ferrotune-cast"

/** The virtual session client that stands for this device's Cast receiver (web `getCastClientId`). */
fun castClientId(myClientId: String): String = "$CAST_CLIENT_NAME:$myClientId"

/** The Cast sender, as seen by [CastPlaybackHandoff]; implemented by [CastManager]. */
interface CastSessionPort {
    val state: StateFlow<CastConnectionState>
    val status: StateFlow<CastMediaStatus>

    suspend fun loadQueue(items: List<CastMediaItem>, startIndex: Int, startTimeMs: Long, repeatMode: String): Boolean
}

/** The local engine, as seen by [CastPlaybackHandoff]; implemented by `PlaybackSessionStarter`. */
interface CastHandoffPlayback {
    val state: StateFlow<PlaybackState>

    suspend fun pauseLocal()

    suspend fun castMediaItems(): List<CastMediaItem>

    /** Reloads the local engine, paused, at the server's current track and position. */
    suspend fun resyncFromServer()
}

/**
 * Moves the shared session's audio to a Cast receiver and back, like the
 * web client's `use-cast`:
 *
 * - On connect: claims the session for the receiver's virtual client (every
 *   other client, this phone included, pauses), then loads the queue on the
 *   receiver from the phone's position.
 * - While casting: heartbeats the receiver's track and position so the server
 *   (and other clients) follow it.
 * - On disconnect: hands the session back to this phone, paused where the
 *   receiver stopped, and reloads the local engine there.
 *
 * App-scoped because a Cast session outlives any screen.
 */
@Singleton
class CastPlaybackHandoff(
    private val cast: CastSessionPort,
    private val playback: CastHandoffPlayback,
    private val apiProvider: FerrotuneApiProvider,
    private val accounts: Accounts,
    dispatcher: CoroutineDispatcher,
    private val heartbeatIntervalMs: Long = HEARTBEAT_INTERVAL_MS,
) {
    @Inject
    constructor(
        cast: CastSessionPort,
        playback: CastHandoffPlayback,
        apiProvider: FerrotuneApiProvider,
        accounts: Accounts,
    ) : this(cast, playback, apiProvider, accounts, Dispatchers.Main.immediate)

    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private var started = false

    /** The receiver's last reported state, for the hand-back after it disconnects. */
    private var lastStatus: CastMediaStatus? = null

    fun start() {
        if (started) return
        started = true
        scope.launch {
            var wasConnected = false
            cast.state.map { it.isConnected }.distinctUntilChanged().collectLatest { connected ->
                if (connected) {
                    wasConnected = true
                    castToReceiver()
                } else if (wasConnected) {
                    wasConnected = false
                    handBackToPhone()
                }
            }
        }
    }

    /** Stops following the Cast session (tests; the app keeps it for its lifetime). */
    fun stop() {
        scope.cancel()
    }

    private suspend fun castToReceiver() {
        val local = playback.state.value
        val sessionId = local.sessionId ?: return
        val receiverId = castClientId(accounts.clientId())
        lastStatus = null
        playback.pauseLocal()
        // A resumed Cast session (e.g. reopening the app) is already playing our
        // queue, possibly songs ahead of the paused phone: adopt it instead of
        // reloading it from the phone's stale position (web `claimCastAndAdopt`).
        val playing = withTimeoutOrNull(RECEIVER_STATUS_WAIT_MS) { cast.status.first { it.songId != null } }
        claim(
            sessionId,
            receiverId,
            positionMs = playing?.positionMs ?: local.positionMs.coerceAtLeast(0),
            currentIndex = playing?.queuePosition ?: local.queueIndex.takeIf { it >= 0 },
        )
        if (playing == null) {
            val items = runCatching { playback.castMediaItems() }.getOrDefault(emptyList())
            if (items.isNotEmpty()) {
                cast.loadQueue(items, castStartIndex(items, local), local.positionMs.coerceAtLeast(0), local.repeatMode)
            }
        }
        // Report the receiver until the session ends (collectLatest cancels this loop).
        // Heartbeats carry live progress to other clients; the queue's current
        // entry only moves through the owner's position updates (web use-cast).
        var reportedIndex: Int? = null
        while (true) {
            val status = cast.status.value
            if (status.songId != null) {
                lastStatus = status
                heartbeat(sessionId, receiverId, CAST_CLIENT_NAME, status, status.isPlaying)
                val index = status.queuePosition
                if (index != null && index != reportedIndex) {
                    reportedIndex = index
                    updatePosition(sessionId, receiverId, index, status.positionMs)
                }
            }
            delay(heartbeatIntervalMs)
        }
    }

    private suspend fun updatePosition(sessionId: String, clientId: String, index: Int, positionMs: Long) {
        runCatching {
            apiCall {
                apiProvider.requireApi().updateQueuePosition(
                    UpdateQueuePositionRequest(
                        sessionId = sessionId,
                        clientId = clientId,
                        currentIndex = index,
                        positionMs = positionMs.coerceAtLeast(0),
                    ),
                )
            }
        }
    }

    private suspend fun claim(sessionId: String, receiverId: String, positionMs: Long, currentIndex: Int?) {
        runCatching {
            apiCall {
                apiProvider.requireApi().sessionCommand(
                    sessionId,
                    SessionCommandRequest(
                        action = "takeOver",
                        positionMs = positionMs,
                        currentIndex = currentIndex,
                        clientName = CAST_CLIENT_NAME,
                        clientId = receiverId,
                        resumePlayback = true,
                    ),
                )
            }
        }
    }

    private suspend fun handBackToPhone() {
        val sessionId = playback.state.value.sessionId ?: return
        val myClientId = accounts.clientId()
        val status = lastStatus
        lastStatus = null
        runCatching {
            if (status != null) {
                // The receiver's final entry and position, written while it still owns the session.
                val receiverId = castClientId(myClientId)
                heartbeat(sessionId, receiverId, CAST_CLIENT_NAME, status, isPlaying = false)
                status.queuePosition?.let { updatePosition(sessionId, receiverId, it, status.positionMs) }
            }
            apiCall {
                apiProvider.requireApi().sessionCommand(
                    sessionId,
                    SessionCommandRequest(
                        action = "takeOver",
                        positionMs = status?.positionMs,
                        currentIndex = status?.queuePosition,
                        clientName = PHONE_CLIENT_NAME,
                        clientId = myClientId,
                        resumePlayback = false,
                    ),
                )
            }
        }
        runCatching { playback.resyncFromServer() }
    }

    private suspend fun heartbeat(
        sessionId: String,
        clientId: String,
        clientName: String,
        status: CastMediaStatus,
        isPlaying: Boolean,
    ) {
        runCatching {
            apiCall {
                apiProvider.requireApi().sessionHeartbeat(
                    sessionId,
                    SessionHeartbeatRequest(
                        clientId = clientId,
                        clientName = clientName,
                        isPlaying = isPlaying,
                        currentIndex = status.queuePosition,
                        positionMs = status.positionMs,
                        currentSongId = status.songId,
                        currentSongTitle = status.title,
                        currentSongArtist = status.artist,
                    ),
                )
            }
        }
    }

    private companion object {
        const val HEARTBEAT_INTERVAL_MS = 5_000L
        const val RECEIVER_STATUS_WAIT_MS = 1_500L
        const val PHONE_CLIENT_NAME = "ferrotune-mobile"
    }
}

/**
 * The receiver queue item for the phone's current entry, matched by queue
 * position (a song can appear twice in a queue), then by song id.
 */
internal fun castStartIndex(items: List<CastMediaItem>, local: PlaybackState): Int =
    items.indexOfFirst { it.position == local.queueIndex }.takeIf { it >= 0 }
        ?: items.indexOfFirst { it.songId == local.track?.id }.takeIf { it >= 0 }
        ?: 0
