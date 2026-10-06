package com.ferrotune.core.designsystem.components

import org.junit.Assert.assertEquals
import org.junit.Test

class CoverViewerTest {
    @Test
    fun `pinch zoom stays between fit and the maximum`() {
        assertEquals(2f, coverZoom(1f, 2f), 0.0001f)
        assertEquals(1f, coverZoom(1.2f, 0.5f), 0.0001f)
        assertEquals(COVER_MAX_ZOOM, coverZoom(4f, 3f), 0.0001f)
    }
}
