package com.ferrotune.core.media

import java.nio.file.Files
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

    @Test
    fun uploadsTheNewestLogLinesFirstWithinTheBudget() {
        val directory = Files.createTempDirectory("native-audio").toFile()
        try {
            directory.resolve("native-audio-2.jsonl").writeText("{\"n\":1}\n{\"n\":2}\n")
            directory.resolve("native-audio-1.jsonl").writeText("{\"n\":3}\n{\"n\":4}\n")
            directory.resolve("native-audio-current.jsonl").writeText("{\"n\":5}\n")
            val files = NativeAudioLogger.newestLogFiles(directory)
            assertEquals(
                listOf("native-audio-current.jsonl", "native-audio-1.jsonl", "native-audio-2.jsonl"),
                files.map { it.name },
            )

            fun upload(maxBytes: Long) = NativeAudioLogger.newestLogContent(files, maxBytes)
                .map { (file, content) -> file.name to String(content) }

            // Everything fits.
            assertEquals(3, upload(1_000).size)
            // The current file plus the last whole line of the next one: a
            // cut never leaves a partial JSON line.
            assertEquals(
                listOf("native-audio-current.jsonl" to "{\"n\":5}\n", "native-audio-1.jsonl" to "{\"n\":4}\n"),
                upload(18),
            )
            assertEquals(listOf("native-audio-current.jsonl" to "{\"n\":5}\n"), upload(12))
            assertEquals(emptyList<Pair<String, String>>(), upload(0))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun namesStandbyBucketsAndExitReasons() {
        assertEquals("restricted", DiagnosticsDeviceState.standbyBucketName(45))
        assertEquals("active", DiagnosticsDeviceState.standbyBucketName(10))
        assertEquals("unknown(7)", DiagnosticsDeviceState.standbyBucketName(7))
        assertEquals("low_memory", DiagnosticsDeviceState.exitReasonName(3))
        assertEquals("user_requested", DiagnosticsDeviceState.exitReasonName(10))
        assertEquals("freezer", DiagnosticsDeviceState.exitReasonName(14))
    }
}
