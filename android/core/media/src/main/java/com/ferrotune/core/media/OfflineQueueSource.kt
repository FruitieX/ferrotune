package com.ferrotune.core.media


/**
 * Supplies a locally materialized queue when the server is unreachable.
 * Implemented by the downloads feature from persisted download metadata.
 */
interface OfflineQueueSource {
    suspend fun offlineQueue(
        sourceType: String,
        sourceId: String?,
        startSongId: String?,
    ): GetQueueResponse?
}
