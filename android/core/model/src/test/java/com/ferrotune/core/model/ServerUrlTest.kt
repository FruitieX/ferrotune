package com.ferrotune.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerUrlTest {
    @Test
    fun `adds http scheme when missing`() {
        assertEquals("http://192.168.1.100:4040", ServerUrl.normalize("192.168.1.100:4040"))
    }

    @Test
    fun `keeps https scheme`() {
        assertEquals("https://music.example.com", ServerUrl.normalize("https://music.example.com"))
    }

    @Test
    fun `trims whitespace and trailing slashes`() {
        assertEquals("http://music.local", ServerUrl.normalize("  http://music.local/  "))
    }

    @Test
    fun `display label uses username and host`() {
        assertEquals(
            "rasse@192.168.1.100",
            Account.displayLabel("rasse", "http://192.168.1.100:4040"),
        )
    }

    @Test
    fun `display label falls back to username without host`() {
        assertEquals("rasse", Account.displayLabel("rasse", "not a url"))
    }
}
