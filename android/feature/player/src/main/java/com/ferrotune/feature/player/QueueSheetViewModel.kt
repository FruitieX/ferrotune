package com.ferrotune.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.feature.player.data.QUEUE_PAGE_SIZE
import com.ferrotune.feature.player.data.QueueEntry
import com.ferrotune.feature.player.data.QueueRepository
import com.ferrotune.feature.player.data.alignedQueueKey
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Queue header state. The engine's queue index is authoritative for the
 * now-playing highlight: the server snapshot can lag behind it when position
 * syncs were dropped while the app played in the background.
 */
data class QueueSheetUiState(
    val sessionId: String? = null,
    val currentIndex: Int = -1,
    val isPlaying: Boolean = false,
    val sourceName: String? = null,
    val sourceType: String? = null,
    val sourceId: String? = null,
)

/** What forces a fresh page load: a different session, queue shape, or an explicit refresh. */
private data class QueueGeneration(
    val sessionId: String?,
    val queueLength: Int,
    val isShuffled: Boolean,
    val sourceId: String?,
    val refreshes: Int,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class QueueSheetViewModel @Inject constructor(
    private val queueRepository: QueueRepository,
    private val playbackStarter: PlaybackStarter,
    private val messages: UserMessages,
) : ViewModel() {

    private val refreshes = MutableStateFlow(0)

    val uiState: StateFlow<QueueSheetUiState> = playbackStarter.state
        .map {
            QueueSheetUiState(
                sessionId = it.sessionId,
                currentIndex = it.queueIndex,
                isPlaying = it.status == PlaybackStatus.PLAYING || it.status == PlaybackStatus.BUFFERING,
                sourceName = it.sourceName,
                sourceType = it.sourceType,
                sourceId = it.sourceId,
            )
        }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), QueueSheetUiState())

    /**
     * The whole queue, paged with placeholders so positions are list indices.
     * Starts at the page holding the current track.
     */
    val entries: Flow<PagingData<QueueEntry>> = combine(
        playbackStarter.state,
        refreshes,
    ) { state, refresh ->
        QueueGeneration(state.sessionId, state.queueLength, state.isShuffled, state.sourceId, refresh)
    }
        .distinctUntilChanged()
        .flatMapLatest { generation ->
            val session = generation.sessionId
            if (session == null) {
                flowOf(PagingData.empty())
            } else {
                Pager(
                    config = PagingConfig(
                        pageSize = QUEUE_PAGE_SIZE,
                        initialLoadSize = QUEUE_PAGE_SIZE * 2,
                        enablePlaceholders = true,
                        jumpThreshold = QUEUE_PAGE_SIZE * 3,
                    ),
                    initialKey = alignedQueueKey(playbackStarter.state.value.queueIndex - 5),
                ) { queueRepository.queuePages(session) }.flow
            }
        }
        .cachedIn(viewModelScope)

    /** Reloads the queue pages (opening the sheet, returning to the app). */
    fun reload() {
        refreshes.value++
    }

    fun jumpTo(position: Int) {
        viewModelScope.launch {
            runCatching { playbackStarter.playAtIndex(position) }
                .onFailure { messages.failure("Couldn't play that track", it) }
        }
    }

    fun remove(entry: QueueEntry) {
        mutate("Couldn't remove from queue") { session -> queueRepository.removeEntry(session, entry.position) }
    }

    fun clear() {
        mutate("Couldn't clear the queue", success = "Cleared the queue") { session ->
            queueRepository.clear(session)
        }
    }

    /** Moves [entry] to queue position [toPosition] (drag & drop or "Move to position"). */
    fun moveTo(entry: QueueEntry, toPosition: Long) {
        val target = toPosition.coerceAtLeast(0)
        if (target == entry.position) return
        mutate("Couldn't move the track") { session ->
            queueRepository.moveEntry(session, entry.position, target)
        }
    }

    private fun mutate(failure: String, success: String? = null, block: suspend (String) -> Unit) {
        val session = uiState.value.sessionId ?: playbackStarter.state.value.sessionId ?: return
        viewModelScope.launch {
            runCatching { block(session) }
                .onSuccess {
                    success?.let(messages::show)
                    reload()
                    // Don't wait for the server's queue event: skipping right
                    // after a move must play the new next track.
                    runCatching { playbackStarter.refreshQueue() }
                }
                .onFailure { messages.failure(failure, it) }
        }
    }
}
