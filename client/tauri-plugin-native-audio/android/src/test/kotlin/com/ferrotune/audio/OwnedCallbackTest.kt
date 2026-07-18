package com.ferrotune.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnedCallbackTest {
    @Test
    fun staleOwnerCannotClearReplacementCallback() {
        val callback = OwnedCallback<String, Int>()
        val oldOwner = Any()
        val replacementOwner = Any()
        val received = mutableListOf<String>()

        callback.set(oldOwner) { event, value -> received += "old:$event:$value" }
        callback.emit("ready", 1)

        callback.set(replacementOwner) { event, value -> received += "new:$event:$value" }
        assertFalse(callback.clear(oldOwner))
        callback.emit("playing", 2)

        assertTrue(callback.clear(replacementOwner))
        callback.emit("ignored", 3)

        assertEquals(listOf("old:ready:1", "new:playing:2"), received)
    }
}
