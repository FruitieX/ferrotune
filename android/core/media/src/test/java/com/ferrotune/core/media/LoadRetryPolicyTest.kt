package com.ferrotune.core.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoadRetryPolicyTest {
    @Test
    fun networkErrorsRetryQuicklyAtFirst() {
        assertEquals(1_000L, transcodedStreamRetryDelayMs(errorCount = 1, httpStatus = null))
        assertEquals(5_000L, transcodedStreamRetryDelayMs(errorCount = 10, httpStatus = null))
    }

    @Test
    fun aBriefNetworkLossDoesNotEndTheLoad() {
        // A cell handover can block DNS for longer than the quick retries.
        val slowDelays = (11..18).map { transcodedStreamRetryDelayMs(errorCount = it, httpStatus = null) }

        assertEquals(
            listOf(30_000L, 60_000L, 120_000L, 240_000L, 300_000L, 300_000L, 300_000L, 300_000L),
            slowDelays,
        )
        // About half an hour later the load gives up, so a paused player stops waking the radio.
        assertNull(transcodedStreamRetryDelayMs(errorCount = 19, httpStatus = null))
    }

    @Test
    fun clientErrorsAreNotRetried() {
        assertNull(transcodedStreamRetryDelayMs(errorCount = 1, httpStatus = 404))
        assertEquals(1_000L, transcodedStreamRetryDelayMs(errorCount = 1, httpStatus = 429))
        assertEquals(1_000L, transcodedStreamRetryDelayMs(errorCount = 1, httpStatus = 503))
    }
}
