package com.ferrotune.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.feature.player.data.QueueEntry
import com.ferrotune.feature.player.data.QueueRepository
import com.ferrotune.feature.player.data.QueueSnapshot
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class QueueSheetUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val totalCount: Int = 0,
    val currentIndex: Int = 0,
    val isShuffled: Boolean = false,
    val repeatMode: String = "off",
    val sourceName: String? = null,
    val entries: List<QueueEntry> = emptyList(),
)

@HiltViewModel
class QueueSheetViewModel @Inject constructor(
    private val queueRepository: QueueRepository,
    private val playbackStarter: PlaybackStarter,
) : ViewModel() {

    private val _uiState = MutableStateFlow(QueueSheetUiState())
    val uiState: StateFlow<QueueSheetUiState> = _uiState.asStateFlow()

    private var sessionId: String? = null
    private var loadJob: Job? = null

    init {
        viewModelScope.launch {
            playbackStarter.state
                .map { Triple(it.sessionId, it.queueIndex, it.queueLength) }
                .distinctUntilChanged()
                .collect { (session, index, _) ->
                    if (session != null) {
                        sessionId = session
                        load(session, index)
                    } else {
                        _uiState.update { it.copy(loading = false) }
                    }
                }
        }
    }

    fun reload() {
        val session = sessionId ?: return
        load(session, playbackStarter.state.value.queueIndex)
    }

    private fun load(session: String, currentIndex: Int) {
        // Track changes can land faster than the window round-trip; cancel the
        // superseded fetch so a late response can't overwrite a newer snapshot.
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            try {
                val snapshot = queueRepository.loadQueue(session, currentIndex)
                _uiState.update {
                    it.copy(
                        loading = false,
                        error = null,
                        totalCount = snapshot.totalCount,
                        currentIndex = highlightIndex(snapshot, currentIndex),
                        isShuffled = snapshot.isShuffled,
                        repeatMode = snapshot.repeatMode,
                        sourceName = snapshot.sourceName,
                        entries = snapshot.entries,
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load queue")
                }
            }
        }
    }

    /**
     * The engine's queue index is authoritative for what is playing on this
     * device; the server snapshot can lag behind it when position syncs are
     * dropped while the app is in the background. Fall back to the server
     * index only when the engine index is outside the returned window (e.g.
     * the queue was replaced by another client).
     */
    private fun highlightIndex(snapshot: QueueSnapshot, engineIndex: Int): Int =
        engineIndex.takeIf {
            it >= 0 && it >= snapshot.offset && it < snapshot.offset + snapshot.entries.size
        } ?: snapshot.currentIndex

    fun jumpTo(position: Int) {
        viewModelScope.launch {
            playbackStarter.playAtIndex(position)
        }
    }

    fun remove(position: Long) {
        mutate { session -> queueRepository.removeEntry(session, position) }
    }

    fun clear() {
        mutate { session -> queueRepository.clear(session) }
    }

    fun moveUp(entry: QueueEntry) {
        if (entry.position <= 0) return
        mutate { session -> queueRepository.moveEntry(session, entry.position, entry.position - 1) }
    }

    fun moveDown(entry: QueueEntry) {
        mutate { session ->
            queueRepository.moveEntry(session, entry.position, entry.position + 1)
        }
    }

    /** Moves [entry] by [slots] positions (negative = up) for drag & drop. */
    fun move(entry: QueueEntry, slots: Int) {
        val target = (entry.position + slots).coerceAtLeast(0)
        if (target == entry.position) return
        mutate { session -> queueRepository.moveEntry(session, entry.position, target) }
    }

    fun toggleShuffle() {
        val state = _uiState.value
        mutate { session -> queueRepository.setShuffled(session, !state.isShuffled) }
    }

    fun cycleRepeat() {
        val next = when (_uiState.value.repeatMode) {
            "off" -> "all"
            "all" -> "one"
            else -> "off"
        }
        mutate { session -> queueRepository.setRepeatMode(session, next) }
    }

    private fun mutate(block: suspend (String) -> Unit) {
        val session = sessionId ?: return
        viewModelScope.launch {
            try {
                block(session)
                load(session, playbackStarter.state.value.queueIndex)
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to update queue")
                }
            }
        }
    }
}
