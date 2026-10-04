package com.ferrotune.feature.player.data

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.QueueParams
import com.ferrotune.core.network.toQueryMap

/**
 * The whole server queue as placeholder-backed pages, so list indices are
 * queue positions: the sheet can open at the current track and jump
 * anywhere in a long queue (web `VirtualizedQueueDisplay`). Keys are page
 * starts aligned to [pageSize], which keeps prepends from overlapping.
 */
class QueuePagingSource(
    private val apiProvider: FerrotuneApiProvider,
    private val sessionId: String,
    private val pageSize: Int = QUEUE_PAGE_SIZE,
) : PagingSource<Int, QueueEntry>() {

    override val jumpingSupported: Boolean = true

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, QueueEntry> {
        val offset = alignedQueueKey(params.key ?: 0, pageSize)
        val limit = when (params) {
            is LoadParams.Refresh -> maxOf(params.loadSize, pageSize).let { (it + pageSize - 1) / pageSize * pageSize }
            else -> pageSize
        }
        return try {
            val api = apiProvider.requireApi()
            val response = apiCall {
                api.queue(
                    QueueParams(
                        sessionId = sessionId,
                        offset = offset,
                        limit = limit,
                        inlineImages = "small",
                    ).toQueryMap(),
                )
            }
            val snapshot = response.toSnapshot()
            val total = snapshot.totalCount
            val end = offset + snapshot.entries.size
            LoadResult.Page(
                data = snapshot.entries,
                prevKey = if (offset > 0) offset - pageSize else null,
                nextKey = if (end < total && snapshot.entries.isNotEmpty()) end else null,
                itemsBefore = offset.coerceAtMost(total),
                itemsAfter = (total - end).coerceAtLeast(0),
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    override fun getRefreshKey(state: PagingState<Int, QueueEntry>): Int? =
        state.anchorPosition?.let { alignedQueueKey(it, pageSize) }
}

const val QUEUE_PAGE_SIZE = 50

/** Page start for [position], so the first load of a queue contains it. */
fun alignedQueueKey(position: Int, pageSize: Int = QUEUE_PAGE_SIZE): Int =
    (position.coerceAtLeast(0) / pageSize) * pageSize
