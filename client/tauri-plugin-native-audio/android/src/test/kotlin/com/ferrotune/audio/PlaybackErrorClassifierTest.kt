package com.ferrotune.audio

import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackErrorClassifierTest {
    @Test
    fun authHttpStatusesAreTerminalAuthFailures() {
        val unauthorized = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            401,
            "Unauthorized",
        )
        val forbidden = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            403,
            "Forbidden",
        )

        assertEquals(PlaybackErrorCategory.AUTH, unauthorized.category)
        assertEquals(PlaybackErrorCategory.AUTH, forbidden.category)
        assertFalse(unauthorized.retryable)
        assertFalse(forbidden.retryable)
    }

    @Test
    fun transientHttpStatusesAreRetryableNetworkFailures() {
        val timeout = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            408,
            "Timeout",
        )
        val unavailable = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            503,
            "Unavailable",
        )

        assertEquals(PlaybackErrorCategory.NETWORK, timeout.category)
        assertEquals(PlaybackErrorCategory.NETWORK, unavailable.category)
        assertTrue(timeout.retryable)
        assertTrue(unavailable.retryable)
    }

    @Test
    fun fileAndRangeFailuresAreNotRetriedAsNetworkErrors() {
        val missing = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
            null,
            "Missing",
        )
        val badRange = classifyPlaybackError(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            416,
            "Range Not Satisfiable",
        )

        assertEquals(PlaybackErrorCategory.SOURCE_MISSING, missing.category)
        assertEquals(PlaybackErrorCategory.RANGE, badRange.category)
        assertFalse(missing.retryable)
        assertFalse(badRange.retryable)
    }
}