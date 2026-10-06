package com.ferrotune.core.designsystem.components

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WaveformTransitionTest {

    @Test
    fun `downsampling averages bins and missing data is flat`() {
        assertArrayEquals(floatArrayOf(0.2f, 0.6f), downsampleHeights(listOf(0.1f, 0.3f, 0.5f, 0.7f), 2), 0.0001f)
        assertArrayEquals(floatArrayOf(0.5f, 0.5f, 1f, 1f), downsampleHeights(listOf(0.5f, 1f), 4), 0.0001f)
        assertArrayEquals(FloatArray(3) { FLAT_BAR_HEIGHT }, downsampleHeights(emptyList(), 3), 0.0001f)
    }

    @Test
    fun `bars ahead of the outgoing front keep the old height, bars behind it go flat`() {
        // Front at 0.5: a bar at 0.9 is untouched; a bar at 0.1 has flattened.
        assertEquals(0.8f, waveformTransitionHeight(0.9f, outProgress = 0.5f, inProgress = 0f, outgoing = 0.8f, incoming = 0.3f), 0.0001f)
        assertEquals(FLAT_BAR_HEIGHT, waveformTransitionHeight(0.1f, outProgress = 0.5f, inProgress = 0f, outgoing = 0.8f, incoming = 0.3f), 0.0001f)
    }

    @Test
    fun `bars behind the incoming front show the new height`() {
        assertEquals(0.3f, waveformTransitionHeight(0.1f, outProgress = WAVE_END, inProgress = 0.5f, outgoing = 0.8f, incoming = 0.3f), 0.0001f)
        // Not reached yet: still flat after the outgoing sweep.
        assertEquals(FLAT_BAR_HEIGHT, waveformTransitionHeight(0.9f, outProgress = WAVE_END, inProgress = 0.5f, outgoing = 0.8f, incoming = 0.3f), 0.0001f)
    }

    @Test
    fun `the incoming wave starts once the outgoing one is the gap ahead, and both finish`() {
        var out = 0.001f
        var inP = 0f
        var elapsed = 0f
        while (inP == 0f) {
            val (o, i) = advanceWaveformTransition(out, inP, 0.016f)
            out = o
            inP = i
            elapsed += 0.016f
        }
        assertTrue(out >= WAVE_GAP)
        assertEquals(WAVE_GAP, elapsed, 0.02f)
        while (out < WAVE_END || inP < WAVE_END) {
            val (o, i) = advanceWaveformTransition(out, inP, 0.016f)
            out = o
            inP = i
            elapsed += 0.016f
        }
        // One second per sweep at web speed, plus the gap.
        assertEquals(WAVE_END + WAVE_GAP, elapsed, 0.05f)
    }
}
