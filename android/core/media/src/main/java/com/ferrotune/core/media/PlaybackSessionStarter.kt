package com.ferrotune.core.media

import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.generated.StartQueueRequest
import com.ferrotune.core.network.generated.StartQueueResponse
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
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
) : PlaybackStarter {
    override suspend fun startQueue(spec: QueueStartSpec) {
        val account = accountStore.activeAccount.first()
            ?: throw IllegalStateException("Not signed in")
        val clientId = accountStore.clientId()
        val api = apiProvider.requireApi()

        val session = apiCall {
            api.connectSession(ConnectSessionRequest(clientId = clientId))
        }
        val request = buildStartQueueRequest(spec, session.id, clientId)
        val queue = apiCall { api.startQueue(request) }

        repository.initSession(
            config = SessionConfig(
                serverUrl = account.serverUrl,
                username = account.username,
                sessionToken = account.sessionToken,
                sessionExpiresAt = account.sessionExpiresAt,
                sessionId = session.id,
                clientId = clientId,
            ),
            settings = PlaybackSettings(),
        )
        repository.startPlayback(
            totalCount = queue.totalCount.toInt(),
            currentIndex = queue.currentIndex.toInt(),
            isShuffled = queue.isShuffled,
            repeatMode = queue.repeatMode,
            sessionId = session.id,
            sourceType = spec.sourceType,
            sourceId = spec.sourceId,
        )
    }

    override suspend fun startRandomQueue(size: Int) {
        val songs = apiCall { apiProvider.requireApi().randomSongs(size) }.song
        check(songs.isNotEmpty()) { "Server returned no songs" }
        startQueue(
            QueueStartSpec(
                sourceType = SOURCE_TYPE_OTHER,
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

    private companion object {
        const val DEFAULT_RANDOM_QUEUE_SIZE = 50
        const val SOURCE_TYPE_OTHER = "other"
        const val SOURCE_TYPE_SONG_RADIO = "songRadio"
        const val SOURCE_TYPE_ALBUM = "album"
        const val SOURCE_TYPE_ARTIST = "artist"
    }
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
    sources = emptyList(),
    inlineImages = null,
    clientId = clientId,
    clientName = CLIENT_NAME,
    keepPlaying = spec.keepPlaying,
)

fun queueSort(field: String, direction: String): Map<String, JsonElement> =
    mapOf(
        "field" to JsonPrimitive(field),
        "direction" to JsonPrimitive(direction),
    )

private const val CLIENT_NAME = "ferrotune-mobile"
