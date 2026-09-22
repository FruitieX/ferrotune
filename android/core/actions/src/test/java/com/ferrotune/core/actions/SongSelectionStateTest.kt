package com.ferrotune.core.actions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SongSelectionStateTest {

    @Test
    fun `selection is inactive until a song is selected`() {
        val state = SongSelectionState()

        assertFalse(state.isActive)
        assertEquals(0, state.count)

        state.select("song-1")

        assertTrue(state.isActive)
        assertEquals(1, state.count)
    }

    @Test
    fun `toggle adds and removes a song`() {
        val state = SongSelectionState()

        state.toggle("song-1")
        state.toggle("song-2")
        assertEquals(setOf("song-1", "song-2"), state.selectedIds)

        state.toggle("song-1")
        assertEquals(setOf("song-2"), state.selectedIds)
    }

    @Test
    fun `replace selects a whole collection`() {
        val state = SongSelectionState()

        state.replace(listOf("song-1", "song-2", "song-3"))

        assertEquals(3, state.count)
    }

    @Test
    fun `clear drops every selection`() {
        val state = SongSelectionState()
        state.replace(listOf("song-1", "song-2"))

        state.clear()

        assertFalse(state.isActive)
        assertTrue(state.selectedIds.isEmpty())
    }
}
