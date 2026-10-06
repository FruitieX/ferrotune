package com.ferrotune.feature.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueReorderStateTest {
    @Test fun `dragging down opens the target slot by shifting intervening rows up`() {
        val state = QueueReorderState()
        state.start("entry", 1)
        state.dragBy(128f, 64f, 6)
        val preview = state.preview!!
        assertEquals(3, preview.target)
        assertEquals(listOf(0, 0, -1, -1, 0, 0), (0..5).map(preview::displacement))
        assertEquals(2, state.finish(64f))
    }

    @Test fun `a released move stays at its target until the reloaded queue shows it`() {
        val state = QueueReorderState()
        state.start("moved", 1)
        state.dragBy(150f, 64f, 6)

        assertEquals(2, state.finish(64f))
        val settled = state.preview!!
        assertTrue(settled.settled)
        assertEquals(128f, settled.offsetY, 0f)
        // Old rows: the target slot still holds another entry, so keep drawing the move.
        assertEquals(settled, state.visiblePreview { if (it == 3) "other" else null })
        // Reloaded rows put the moved entry at its target: stop drawing the preview.
        assertNull(state.visiblePreview { if (it == 3) "moved" else null })
    }

    @Test fun `dragging up shifts intervening rows down`() {
        val state = QueueReorderState()
        state.start("entry", 4)
        state.dragBy(-192f, 64f, 6)
        val preview = state.preview!!
        assertEquals(1, preview.target)
        assertEquals(listOf(0, 1, 1, 1, 0, 0), (0..5).map(preview::displacement))
        assertEquals(-3, state.finish(64f))
    }

    @Test fun `preview clamps to queue ends while the item follows the pointer`() {
        val state = QueueReorderState()
        state.start("entry", 1)
        state.dragBy(-1000f, 64f, 3)
        assertEquals(0, state.preview!!.target)
        assertEquals(-1000f, state.preview!!.offsetY, 0f)
        state.dragBy(2000f, 64f, 3)
        assertEquals(2, state.preview!!.target)
    }

    @Test fun `reversing a drag restores rows that no longer need to shift`() {
        val state = QueueReorderState()
        state.start("entry", 1)
        state.dragBy(128f, 64f, 5)
        state.dragBy(-192f, 64f, 5)
        assertEquals(0, state.preview!!.target)
        assertEquals(listOf(1, 0, 0, 0, 0), (0..4).map(state.preview!!::displacement))
    }

    @Test fun `small drag and cancellation do not move the song`() {
        val state = QueueReorderState()
        state.start("entry", 1)
        state.dragBy(20f, 64f, 5)
        assertEquals(0, state.finish(64f))
        state.start("entry", 1)
        state.dragBy(100f, 64f, 5)
        state.cancel()
        assertNull(state.preview)
        assertEquals(0, state.finish(64f))
    }
}
