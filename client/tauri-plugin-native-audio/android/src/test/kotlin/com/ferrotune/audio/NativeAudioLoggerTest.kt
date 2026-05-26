package com.ferrotune.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeAudioLoggerTest {
    @Test
    fun sanitizesSensitiveValuesInsideDiagnosticText() {
        val sanitized = NativeAudioLogger.sanitizeForDiagnostics(
            "Authorization: Bearer secret-token https://user:pass@example.test/api/stream?id=song-1&urlToken=url-secret&p=password&t=salt token=loose-token",
        )

        assertFalse(sanitized.contains("secret-token"))
        assertFalse(sanitized.contains("user:pass"))
        assertFalse(sanitized.contains("url-secret"))
        assertFalse(sanitized.contains("password"))
        assertFalse(sanitized.contains("salt"))
        assertFalse(sanitized.contains("loose-token"))
    }

    @Test
    fun sanitizesSensitiveFieldsByKey() {
        assertEquals("[REDACTED]", NativeAudioLogger.sanitizeFieldForDiagnostics("Authorization", "Bearer secret"))
        assertEquals("[REDACTED]", NativeAudioLogger.sanitizeFieldForDiagnostics("sessionToken", "secret"))
        assertEquals("[REDACTED]", NativeAudioLogger.sanitizeFieldForDiagnostics("url_token", "secret"))
        assertEquals("safe", NativeAudioLogger.sanitizeFieldForDiagnostics("message", "safe"))
    }
}