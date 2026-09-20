package com.ferrotune.core.network.paging

import androidx.paging.PagingSource
import androidx.paging.PagingState

const val DEFAULT_PAGE_SIZE = 50

/**
 * Offset-keyed paging over a native API endpoint that reports a total count.
 *
 * Subclasses implement [loadPage]; the base class derives end-of-list from the
 * reported total when available and from a short page otherwise.
 */
abstract class OffsetPagingSource<T : Any> : PagingSource<Int, T>() {
    protected abstract val pageSize: Int

    protected abstract suspend fun loadPage(offset: Int, count: Int): PageResult<T>

    protected data class PageResult<T>(
        val items: List<T>,
        val total: Long?,
    )

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, T> {
        val offset = params.key ?: 0
        return try {
            val page = loadPage(offset, pageSize)
            val reachedEnd = when {
                page.items.isEmpty() -> true
                page.items.size < pageSize -> true
                page.total != null -> offset + page.items.size >= page.total
                else -> false
            }
            LoadResult.Page(
                data = page.items,
                prevKey = if (offset > 0) maxOf(0, offset - pageSize) else null,
                nextKey = if (reachedEnd) null else offset + pageSize,
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }

    override fun getRefreshKey(state: PagingState<Int, T>): Int? {
        val anchor = state.anchorPosition ?: return null
        return (anchor / pageSize) * pageSize
    }
}
