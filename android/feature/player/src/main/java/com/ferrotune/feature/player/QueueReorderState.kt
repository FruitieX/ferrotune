package com.ferrotune.feature.player

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.roundToInt

/**
 * A visual insertion preview; server queue positions change only when the
 * drag ends. After release the preview stays [settled] at its target until
 * the reloaded queue shows the entry there, so the row doesn't snap back.
 */
data class QueueReorderPreview(
    val entryId: String,
    val from: Int,
    val target: Int,
    val offsetY: Float = 0f,
    val settled: Boolean = false,
) {
    fun displacement(index: Int): Int = when {
        target > from && index in (from + 1)..target -> -1
        target < from && index in target until from -> 1
        else -> 0
    }
}

@Stable
class QueueReorderState {
    var preview by mutableStateOf<QueueReorderPreview?>(null)
        private set

    fun start(entryId: String, position: Int) {
        preview = QueueReorderPreview(entryId, position, position)
    }

    fun dragBy(deltaY: Float, slotPx: Float, queueSize: Int) {
        val drag = preview ?: return
        if (slotPx <= 0f || queueSize <= 0) return
        val offset = drag.offsetY + deltaY
        val target = (drag.from.toLong() + (offset / slotPx).roundToInt())
            .coerceIn(0, (queueSize - 1).toLong()).toInt()
        preview = drag.copy(offsetY = offset, target = target)
    }

    /** Ends the drag, keeping the row at its target slot; returns the slots moved. */
    fun finish(slotPx: Float): Int {
        val drag = preview ?: return 0
        val slots = drag.target - drag.from
        preview = if (slots == 0) null else drag.copy(offsetY = slots * slotPx, settled = true)
        return slots
    }

    /**
     * The preview to draw: a settled move is dropped once [entryIdAt] shows
     * the moved entry at its target, i.e. the reloaded queue has it.
     */
    fun visiblePreview(entryIdAt: (Int) -> String?): QueueReorderPreview? =
        preview?.takeUnless { it.settled && entryIdAt(it.target) == it.entryId }

    fun cancel() {
        preview = null
    }
}
