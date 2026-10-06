package com.ferrotune.core.designsystem.components

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow

/** Height of a bar with no data (loading, or between tracks); web `FLAT_BAR_HEIGHT`. */
const val FLAT_BAR_HEIGHT = 0.15f

/** Width of the sweeping wave front, as a fraction of the bar (web `WAVE_WIDTH`). */
internal const val WAVE_WIDTH = 0.15f

/** How far the outgoing wave leads before the incoming one starts (web `PROGRESS_GAP`). */
internal const val WAVE_GAP = 0.4f

/** Sweep speed in bar widths per second (web `ANIMATION_SPEED`). */
internal const val WAVE_SPEED = 1f

/** Where a wave front has fully crossed the bar. */
internal const val WAVE_END = 1f + WAVE_WIDTH

/**
 * [count] bar heights from [source], averaging bins when downsampling (web
 * `downsample`); flat bars when there is no data.
 */
fun downsampleHeights(source: List<Float>, count: Int): FloatArray {
    if (count <= 0) return FloatArray(0)
    if (source.isEmpty()) return FloatArray(count) { FLAT_BAR_HEIGHT }
    if (count >= source.size) return FloatArray(count) { source[it * source.size / count] }
    val ratio = source.size.toFloat() / count
    return FloatArray(count) { i ->
        val start = floor(i * ratio).toInt()
        val end = min(ceil((i + 1) * ratio).toInt(), source.size)
        var sum = 0f
        for (j in start until end) sum += source[j]
        sum / (end - start)
    }
}

/**
 * The web's track-change sweep: an outgoing front flattens the previous
 * track's bars, and an incoming front (starting [WAVE_GAP] behind) raises the
 * new ones. [outProgress]/[inProgress] run from 0 (not started) to
 * [WAVE_END]; [barPosition] is the bar's 0..1 position.
 */
fun waveformTransitionHeight(
    barPosition: Float,
    outProgress: Float,
    inProgress: Float,
    outgoing: Float,
    incoming: Float,
): Float {
    val outT = when {
        outProgress >= WAVE_END -> 1f
        outProgress > 0f -> easeOutCubic(((outProgress - barPosition) / WAVE_WIDTH).coerceIn(0f, 1f))
        else -> 0f
    }
    val inT = if (inProgress > 0f) easeOutCubic(((inProgress - barPosition) / WAVE_WIDTH).coerceIn(0f, 1f)) else 0f
    val afterOut = outgoing * (1 - outT) + FLAT_BAR_HEIGHT * outT
    return afterOut * (1 - inT) + incoming * inT
}

/** Advances a sweep by [deltaSeconds]; returns the new (out, in) progress pair. */
fun advanceWaveformTransition(outProgress: Float, inProgress: Float, deltaSeconds: Float): Pair<Float, Float> {
    val step = WAVE_SPEED * deltaSeconds
    val out = if (outProgress > 0f && outProgress < WAVE_END) min(WAVE_END, outProgress + step) else outProgress
    var inP = inProgress
    if (inP == 0f && out >= WAVE_GAP) inP = 0.001f
    if (inP > 0f && inP < WAVE_END) inP = min(WAVE_END, inP + step)
    return out to inP
}

private fun easeOutCubic(t: Float): Float = 1f - (1f - t).pow(3)
