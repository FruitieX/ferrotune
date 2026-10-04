package com.ferrotune.feature.player.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.dto.MoveInQueueRequest
import com.ferrotune.core.network.dto.QueueParams
import com.ferrotune.core.network.dto.RepeatModeRequest
import com.ferrotune.core.network.dto.SessionParams
import com.ferrotune.core.network.dto.ShuffleRequest
import com.ferrotune.core.network.generated.GetQueueResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.toQueryMap
import kotlinx.serialization.json.decodeFromJsonElement
import javax.inject.Inject
import javax.inject.Singleton

data class QueueEntry(
    val position: Long,
    val entryId: String,
    val song: SongResponse,
)

data class QueueSnapshot(
    val totalCount: Int,
    val currentIndex: Int,
    val isShuffled: Boolean,
    val repeatMode: String,
    val sourceName: String?,
    val offset: Int,
    val entries: List<QueueEntry>,
)

/**
 * Server-side queue reads and edits for the queue sheet. The engine keeps
 * playing; mutations land on the server queue and flow back through SSE.
 */
@Singleton
class QueueRepository @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) {
    /** Paged view of the whole queue for the queue sheet. */
    fun queuePages(sessionId: String): QueuePagingSource = QueuePagingSource(apiProvider, sessionId)

    suspend fun removeEntry(sessionId: String, position: Long) {
        apiProvider.requireApi().removeFromQueue(
            position,
            SessionParams(sessionId = sessionId).toQueryMap(),
        )
    }

    suspend fun clear(sessionId: String) {
        apiProvider.requireApi().clearQueue(SessionParams(sessionId = sessionId).toQueryMap())
    }

    suspend fun moveEntry(sessionId: String, fromPosition: Long, toPosition: Long) {
        apiProvider.requireApi().moveInQueue(
            MoveInQueueRequest(
                sessionId = sessionId,
                fromPosition = fromPosition,
                toPosition = toPosition,
            ),
        )
    }

    suspend fun setShuffled(sessionId: String, enabled: Boolean) {
        apiProvider.requireApi().toggleQueueShuffle(
            ShuffleRequest(sessionId = sessionId, enabled = enabled),
        )
    }

    suspend fun setRepeatMode(sessionId: String, mode: String) {
        apiProvider.requireApi().setQueueRepeatMode(
            RepeatModeRequest(sessionId = sessionId, mode = mode),
        )
    }
}

fun GetQueueResponse.toSnapshot(): QueueSnapshot = QueueSnapshot(
    totalCount = totalCount.toInt(),
    currentIndex = currentIndex.toInt(),
    isShuffled = isShuffled,
    repeatMode = repeatMode,
    sourceName = source.name,
    offset = window.offset.toInt(),
    entries = window.songs.map { entry ->
        QueueEntry(
            position = entry.position,
            entryId = entry.entryId,
            song = FerrotuneJson.decodeFromJsonElement<SongResponse>(entry.song),
        )
    },
)
