package com.ferrotune.core.media

import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.QueueParams
import com.ferrotune.core.network.toQueryMap
import com.ferrotune.core.network.generated.AddToQueueRequest
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Describes the queue to materialize on the server before handing the session
 * to [PlaybackRepository].
 */
data class QueueStartSpec(
    val sourceType: String,
    val sourceId: String? = null,
    val sourceName: String? = null,
    val filters: Map<String, JsonElement> = emptyMap(),
    val sort: Map<String, JsonElement>? = null,
    val songIds: List<String>? = null,
    val sources: List<QueueSourceRequest> = emptyList(),
    val startSongId: String? = null,
    val startIndex: Int = 0,
    val shuffle: Boolean = false,
    val keepPlaying: Boolean = false,
)

/**
 * Starts server-side playback sessions for the signed-in account and hands
 * the resulting session to [PlaybackRepository].
 */
@Singleton
class PlaybackSessionStarter @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val accountStore: AccountStore,
    private val repository: PlaybackRepository,
    private val offlineQueueSource: OfflineQueueSource,
    private val playbackSettingsRepository: PlaybackSettingsRepository,
) : PlaybackStarter {
    /** Serializes explicit queue starts with launch-time session restores. */
    private val sessionMutex = Mutex()

    @Volatile
    private var explicitStarts = 0L

    override suspend fun startQueue(spec: QueueStartSpec) {
        explicitStarts++
        sessionMutex.withLock { startQueueLocked(spec) }
    }

    /**
     * Reattaches to the account's server playback session after launch or an
     * account switch: connects the session (and its SSE stream), records who
     * owns it, and loads the saved queue paused at the saved position so the
     * mini player shows what was playing. Never starts audio and never claims
     * ownership; pressing play does that. Returns false when nothing was
     * restored (no account, already attached, empty queue, or offline).
     */
    override suspend fun restoreSession(): Boolean {
        val startsBefore = explicitStarts
        return sessionMutex.withLock {
            if (explicitStarts != startsBefore) return@withLock false
            val account = accountStore.activeAccount.first() ?: return@withLock false
            val current = repository.refreshState()
            if (current.sessionId != null && current.track != null) return@withLock false

            val clientId = accountStore.clientId()
            val api = apiProvider.requireApi()
            val session = apiCall { api.connectSession(ConnectSessionRequest(clientId = clientId)) }
            repository.initSession(
                config = SessionConfig(
                    serverUrl = account.serverUrl,
                    username = account.username,
                    sessionToken = account.sessionToken,
                    sessionExpiresAt = account.sessionExpiresAt,
                    sessionId = session.id,
                    clientId = clientId,
                ),
                settings = playbackSettingsRepository.ensureLoaded(),
            )
            repository.applyConnectedSessionOwner(
                ownerClientId = session.ownerClientId,
                ownerClientName = session.ownerClientName,
            )
            if (session.isNewSession) return@withLock false

            val queue = apiCall {
                api.queue(QueueParams(sessionId = session.id, offset = 0, limit = 1).toQueryMap())
            }
            val restore = restoredQueue(queue) ?: return@withLock false
            repository.startPlayback(
                totalCount = restore.totalCount,
                currentIndex = restore.currentIndex,
                isShuffled = queue.isShuffled,
                repeatMode = queue.repeatMode,
                startPositionMs = restore.positionMs,
                sessionId = session.id,
                sourceType = queue.source.type,
                sourceId = queue.source.id,
                sourceName = queue.source.name,
                playWhenReady = false,
            )
            true
        }
    }

    private suspend fun startQueueLocked(spec: QueueStartSpec) {
        val account = accountStore.activeAccount.first()
            ?: throw IllegalStateException("Not signed in")
        val clientId = accountStore.clientId()
        val api = apiProvider.requireApi()

        val session = try {
            apiCall { api.connectSession(ConnectSessionRequest(clientId = clientId)) }
        } catch (e: Exception) {
            if (startOfflineQueue(spec)) return
            throw e
        }
        val request = buildStartQueueRequest(spec, session.id, clientId)
        val queue = try {
            apiCall { api.startQueue(request) }
        } catch (e: Exception) {
            if (startOfflineQueue(spec)) return
            throw e
        }

        repository.initSession(
            config = SessionConfig(
                serverUrl = account.serverUrl,
                username = account.username,
                sessionToken = account.sessionToken,
                sessionExpiresAt = account.sessionExpiresAt,
                sessionId = session.id,
                clientId = clientId,
            ),
            settings = playbackSettingsRepository.ensureLoaded(),
        )
        repository.startPlayback(
            totalCount = queue.totalCount.toInt(),
            currentIndex = queue.currentIndex.toInt(),
            isShuffled = queue.isShuffled,
            repeatMode = queue.repeatMode,
            sessionId = session.id,
            sourceType = spec.sourceType,
            sourceId = spec.sourceId,
            sourceName = spec.sourceName,
        )
    }

    /**
     * Materializes a downloaded queue when the server can't be reached.
     * Returns false when nothing is downloaded for the requested source.
     */
    private suspend fun startOfflineQueue(spec: QueueStartSpec): Boolean {
        val response = offlineQueueSource.offlineQueue(
            sourceType = spec.sourceType,
            sourceId = spec.sourceId,
            startSongId = spec.startSongId,
        ) ?: return false
        if (response.totalCount == 0) return false
        if (!repository.hasSessionConfig()) {
            // A cold start without connectivity never connected a session, and
            // the engine ignores offline playback without credentials (it needs
            // them for the download cache). Configure the account without a
            // session id, which also keeps SSE from reconnecting while offline.
            val account = accountStore.activeAccount.first() ?: return false
            repository.initSession(
                config = SessionConfig(
                    serverUrl = account.serverUrl,
                    username = account.username,
                    sessionToken = account.sessionToken,
                    sessionExpiresAt = account.sessionExpiresAt,
                    clientId = accountStore.clientId(),
                ),
                settings = playbackSettingsRepository.ensureLoaded(),
            )
        }
        repository.applySettings(playbackSettingsRepository.ensureLoaded())
        repository.startOfflinePlayback(response, playWhenReady = true)
        return true
    }

    override suspend fun addToQueue(spec: QueueAddSpec, position: QueueAddPosition) {
        check(spec.songIds.isNotEmpty() || spec.sources.isNotEmpty()) {
            "Queue add requires song ids or sources"
        }
        val sessionId = repository.state.value.sessionId
        if (sessionId == null) {
            startQueue(queueStartSpecForAdd(spec))
            return
        }
        val currentIndex = repository.state.value.queueIndex.takeIf { it >= 0 }?.toLong()
        val request = buildAddToQueueRequest(
            spec = spec,
            sessionId = sessionId,
            position = position,
            currentIndex = currentIndex,
        )
        apiCall { apiProvider.requireApi().addToQueue(request) }
    }

    override suspend fun startRandomQueue(size: Int) {
        val songs = apiCall { apiProvider.requireApi().randomSongs(size) }.song
        check(songs.isNotEmpty()) { "Server returned no songs" }
        startQueue(
            QueueStartSpec(
                sourceType = QUEUE_SOURCE_OTHER,
                sourceName = "Random songs",
                songIds = songs.map { it.id },
            )
        )
    }

    override suspend fun startSongRadio(
        seedSongId: String,
        sourceName: String?,
        startSongId: String?,
    ) {
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_SONG_RADIO,
                sourceId = seedSongId,
                sourceName = sourceName,
                startSongId = startSongId,
            )
        )
    }

    override suspend fun startAlbum(albumId: String, sourceName: String?, startSongId: String?) {
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_ALBUM,
                sourceId = albumId,
                sourceName = sourceName,
                startSongId = startSongId,
            )
        )
    }

    override suspend fun startArtist(
        artistId: String,
        sourceName: String?,
        startSongId: String?,
    ) {
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_ARTIST,
                sourceId = artistId,
                sourceName = sourceName,
                startSongId = startSongId,
            )
        )
    }

    override suspend fun playAtIndex(index: Int) = repository.playAtIndex(index)

    override suspend fun startOfflineQueue(
        response: GetQueueResponse,
        playWhenReady: Boolean,
    ) = repository.startOfflinePlayback(response, playWhenReady)

    override val state = repository.state

    private companion object {
        const val DEFAULT_RANDOM_QUEUE_SIZE = 50
        const val SOURCE_TYPE_SONG_RADIO = "songRadio"
        const val SOURCE_TYPE_ALBUM = "album"
        const val SOURCE_TYPE_ARTIST = "artist"
    }
}

/**
 * When "add to queue" runs without an active session, start a queue from the
 * requested songs or sources instead, mirroring the web client.
 */
internal fun queueStartSpecForAdd(spec: QueueAddSpec): QueueStartSpec = QueueStartSpec(
    sourceType = QUEUE_SOURCE_OTHER,
    songIds = spec.songIds.takeIf { it.isNotEmpty() },
    sources = spec.sources,
)

internal const val QUEUE_SOURCE_OTHER = "other"

internal data class RestoredQueue(val totalCount: Int, val currentIndex: Int, val positionMs: Long)

/**
 * Where a launch-time restore should resume the saved server queue, or null
 * when there is nothing to show. The index is clamped because the server keeps
 * the last index even after entries were removed.
 */
internal fun restoredQueue(queue: com.ferrotune.core.network.generated.GetQueueResponse): RestoredQueue? {
    val total = queue.totalCount.toInt()
    if (total <= 0) return null
    return RestoredQueue(
        totalCount = total,
        currentIndex = queue.currentIndex.toInt().coerceIn(0, total - 1),
        positionMs = queue.positionMs.coerceAtLeast(0),
    )
}

internal fun buildStartQueueRequest(
    spec: QueueStartSpec,
    sessionId: String,
    clientId: String,
): StartQueueRequest = StartQueueRequest(
    sessionId = sessionId,
    sourceType = spec.sourceType,
    sourceId = spec.sourceId,
    sourceName = spec.sourceName,
    startIndex = spec.startIndex.toLong(),
    startSongId = spec.startSongId,
    shuffle = spec.shuffle,
    filters = spec.filters.takeIf { it.isNotEmpty() },
    sort = spec.sort,
    songIds = spec.songIds,
    sources = spec.sources,
    inlineImages = null,
    clientId = clientId,
    clientName = CLIENT_NAME,
    keepPlaying = spec.keepPlaying,
)

internal fun buildAddToQueueRequest(
    spec: QueueAddSpec,
    sessionId: String,
    position: QueueAddPosition,
    currentIndex: Long?,
): AddToQueueRequest = AddToQueueRequest(
    sessionId = sessionId,
    songIds = spec.songIds,
    position = JsonPrimitive(
        when (position) {
            QueueAddPosition.NEXT -> "next"
            QueueAddPosition.END -> "end"
        },
    ),
    currentIndex = currentIndex,
    sourceType = null,
    sourceId = null,
    sources = spec.sources,
)

fun queueSort(field: String, direction: String): Map<String, JsonElement> =
    mapOf(
        "field" to JsonPrimitive(field),
        "direction" to JsonPrimitive(direction),
    )

private const val CLIENT_NAME = "ferrotune-mobile"

/**
 * Web `queueTextFilter`: detail pages (album, artist, genre, playlists,
 * favorites, history) queue only the songs matching the visible text filter.
 */
fun queueTextFilter(filter: String): Map<String, JsonElement> {
    val trimmed = filter.trim()
    return if (trimmed.isEmpty()) emptyMap() else mapOf("filter" to JsonPrimitive(trimmed))
}
