package com.ferrotune.feature.player

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.roundToInt

/** A visual insertion preview; server queue positions change only when the drag ends. */
data class QueueReorderPreview(
    val entryId: String,
    val from: Int,
    val target: Int,
    val offsetY: Float = 0f,
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

    fun finish(): Int {
        val slots = preview?.let { it.target - it.from } ?: 0
        cancel()
        return slots
    }

    fun cancel() {
        preview = null
    }
}
