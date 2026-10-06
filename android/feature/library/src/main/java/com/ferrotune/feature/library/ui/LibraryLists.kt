package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.MediaCardSkeleton
import com.ferrotune.core.designsystem.components.PagingListFooter
import com.ferrotune.core.network.readableMessage

/**
 * Paged cards laid out as rows of [columns] inside a lazy list, so a card grid
 * can share one scroll with a header and other sections (web artist page,
 * favorites tabs). Each card receives `Modifier.weight(1f)` via [RowScope].
 */
internal fun <T : Any> LazyListScope.pagedCardRows(
    items: LazyPagingItems<T>,
    columns: Int,
    keyPrefix: String,
    emptyMessage: String,
    /** List mode: one full-width row per item, no card padding (rows bring their own). */
    list: Boolean = false,
    card: @Composable RowScope.(T) -> Unit,
) {
    val columns = if (list) 1 else columns
    val refresh = items.loadState.refresh
    when {
        refresh is LoadState.Error && items.itemCount == 0 -> item(key = "$keyPrefix-error") {
            ErrorState(message = refresh.error.readableMessage() ?: "Failed to load", onRetry = items::retry)
        }

        refresh is LoadState.Loading && items.itemCount == 0 -> item(key = "$keyPrefix-loading") {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                repeat(columns) { MediaCardSkeleton(modifier = Modifier.weight(1f)) }
            }
        }

        items.itemCount == 0 -> item(key = "$keyPrefix-empty") { EmptyState(emptyMessage) }

        else -> {
            val rowCount = (items.itemCount + columns - 1) / columns
            items(count = rowCount, key = { "$keyPrefix-row-$it" }, contentType = { "$keyPrefix-row" }) { row ->
                Row(
                    modifier = if (list) Modifier else Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for (column in 0 until columns) {
                        val index = row * columns + column
                        val item = if (index < items.itemCount) items[index] else null
                        if (item == null) Spacer(Modifier.weight(1f)) else card(item)
                    }
                }
            }
            item(key = "$keyPrefix-footer") {
                PagingListFooter(isLoading = items.loadState.append is LoadState.Loading)
            }
        }
    }
}

/** Card columns for phone-width grids (web: three columns on phones). */
@Composable
internal fun gridColumns(): Int =
    (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp / 128).coerceAtLeast(3)
