package com.ferrotune.core.network

import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * A [StateFlow] whose value is [transform] applied to this flow's value,
 * without a coroutine scope: reads are synchronous, and the last result is
 * reused while the source value is unchanged.
 */
fun <T, R> StateFlow<T>.mapState(transform: (T) -> R): StateFlow<R> = DerivedStateFlow(this, transform)

@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
private class DerivedStateFlow<T, R>(
    private val source: StateFlow<T>,
    private val transform: (T) -> R,
) : StateFlow<R> {
    private class Memo<T, R>(val input: T, val output: R)

    @Volatile
    private var memo: Memo<T, R>? = null

    private fun derive(input: T): R {
        memo?.takeIf { it.input === input }?.let { return it.output }
        return transform(input).also { memo = Memo(input, it) }
    }

    override val value: R get() = derive(source.value)

    override val replayCache: List<R> get() = listOf(value)

    override suspend fun collect(collector: FlowCollector<R>): Nothing {
        source.map(::derive).distinctUntilChanged().collect(collector)
        awaitCancellation()
    }
}
