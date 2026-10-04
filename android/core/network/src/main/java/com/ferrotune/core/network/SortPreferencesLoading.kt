package com.ferrotune.core.network

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.take

/**
 * How long a list waits for its stored sort before loading with defaults, so
 * a slow or offline preferences request never blocks the first page.
 */
const val SORT_PREFERENCES_TIMEOUT_MS = 1_500L

/**
 * Holds emissions back until [ready] is true, then passes them through. Lists
 * gate paging on their stored sort so the first page isn't fetched twice.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun <T> Flow<T>.waitFor(ready: StateFlow<Boolean>): Flow<T> =
    ready.filter { it }.take(1).flatMapLatest { this }
