package com.ferrotune.core.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StreamCacheTest {
    private fun key(path: String, vararg params: Pair<String, String>): String? {
        val query = params.toMap()
        return fullStreamCacheKey(path) { query[it] }
    }

    @Test
    fun transcodedStreamsAreKeyedBySongFormatAndBitrate() {
        assertEquals(
            "audio:so-1:opus:192",
            key("/api/stream", "id" to "so-1", "format" to "opus", "maxBitRate" to "192", "v" to "1.16.1"),
        )
        // A partly cached 192 kbps stream must never be continued at 128 kbps.
        assertNotEquals(
            key("/api/stream", "id" to "so-1", "format" to "opus", "maxBitRate" to "192"),
            key("/api/stream", "id" to "so-1", "format" to "opus", "maxBitRate" to "128"),
        )
    }

    @Test
    fun originalStreamsHaveTheirOwnKey() {
        assertEquals("audio:so-1:original", key("/api/stream", "id" to "so-1"))
    }

    @Test
    fun offsetStreamsAndOtherRequestsAreNotFullStreams() {
        assertNull(key("/api/stream", "id" to "so-1", "format" to "opus", "timeOffset" to "12.5"))
        assertNull(key("/api/cover-art", "id" to "so-1"))
        assertNull(key("/api/stream"))
    }
}
