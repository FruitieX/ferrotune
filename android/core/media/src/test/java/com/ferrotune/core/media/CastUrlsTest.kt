package com.ferrotune.core.media

import org.junit.Assert.assertEquals
import org.junit.Test

class CastUrlsTest {

    @Test
    fun `appends the token to urls with and without query params`() {
        assertEquals(
            "https://music.example/api/stream?id=1&urlToken=abc",
            appendUrlToken("https://music.example/api/stream?id=1", "abc"),
        )
        assertEquals(
            "https://music.example/api/stream?urlToken=abc",
            appendUrlToken("https://music.example/api/stream", "abc"),
        )
    }

    @Test
    fun `leaves the url untouched without a token or with an existing one`() {
        assertEquals(
            "https://music.example/api/stream?id=1",
            appendUrlToken("https://music.example/api/stream?id=1", null),
        )
        assertEquals(
            "https://music.example/api/stream?id=1",
            appendUrlToken("https://music.example/api/stream?id=1", "  "),
        )
        assertEquals(
            "https://music.example/api/stream?id=1&urlToken=old",
            appendUrlToken("https://music.example/api/stream?id=1&urlToken=old", "new"),
        )
    }

    @Test
    fun `opus streams report an ogg content type`() {
        assertEquals(
            "audio/ogg",
            castContentType("https://music.example/api/stream?id=1&format=opus&maxBitRate=192"),
        )
        assertEquals(
            "audio/mpeg",
            castContentType("https://music.example/api/stream?id=1"),
        )
    }
}
