package com.ferrotune.feature.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpNextGroupTest {
    @Test
    fun `up next is the block right after the current track`() {
        // Current track at 2, three songs in up next (3, 4, 5).
        assertNull(upNextGroupAt(1, currentIndex = 2, upNextCount = 3))
        assertNull(upNextGroupAt(2, currentIndex = 2, upNextCount = 3))
        assertEquals(UpNextGroup.FIRST, upNextGroupAt(3, currentIndex = 2, upNextCount = 3))
        assertEquals(UpNextGroup.MIDDLE, upNextGroupAt(4, currentIndex = 2, upNextCount = 3))
        assertEquals(UpNextGroup.LAST, upNextGroupAt(5, currentIndex = 2, upNextCount = 3))
        assertNull(upNextGroupAt(6, currentIndex = 2, upNextCount = 3))
    }

    @Test
    fun `a single up-next song is its own card`() {
        assertEquals(UpNextGroup.ONLY, upNextGroupAt(1, currentIndex = 0, upNextCount = 1))
        assertNull(upNextGroupAt(1, currentIndex = 0, upNextCount = 0))
    }
}
