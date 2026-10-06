package com.ferrotune.feature.player

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ferrotune.feature.player.data.QueueEntry
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

    /** The finger's root Y while dragging, for scrolling near the list edges. */
    var pointerY by mutableFloatStateOf(Float.NaN)

    /**
     * The held entry and where the finger grabbed it (px below the row top),
     * so the panel can draw the row floating under the finger even after
     * edge scrolling carries its list slot off screen.
     */
    var held by mutableStateOf<QueueEntry?>(null)
        private set
    var grabOffset = 0f
        private set

    fun grab(entry: QueueEntry, pointerRootY: Float, rowTopRootY: Float) {
        held = entry
        pointerY = pointerRootY
        grabOffset = pointerRootY - rowTopRootY
    }

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
        release()
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
        release()
    }

    private fun release() {
        pointerY = Float.NaN
        held = null
    }
}

/**
 * Scroll speed (px per frame) while dragging at [pointerY] in a list spanning
 * [top]..[bottom]: zero away from the edges, ramping up to [maxSpeed] as the
 * finger reaches or passes an edge within [edgePx].
 */
fun queueAutoScrollSpeed(pointerY: Float, top: Float, bottom: Float, edgePx: Float, maxSpeed: Float): Float {
    if (pointerY.isNaN() || edgePx <= 0f || bottom <= top) return 0f
    return when {
        pointerY < top + edgePx -> -maxSpeed * ((top + edgePx - pointerY) / edgePx).coerceIn(0f, 1f)
        pointerY > bottom - edgePx -> maxSpeed * ((pointerY - (bottom - edgePx)) / edgePx).coerceIn(0f, 1f)
        else -> 0f
    }
}
