package com.ferrotune.audio

import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.pow

/**
 * ExoPlayer AudioProcessor that applies ReplayGain and detects clipping.
 *
 * Processes PCM audio samples to:
 * 1. Apply gain (both positive and negative dB) directly in the PCM domain
 * 2. Detect clipping (when gained samples would exceed 0 dBFS)
 * 3. Soft-clip (clamp) samples to prevent harsh digital distortion
 * 4. Report clipping state via callback for UI display
 *
 * This replaces LoudnessEnhancer for ReplayGain, giving us:
 * - Full control over gain (positive/negative)
 * - Real-time clipping detection
 * - Soft clipping (clamping) to avoid harsh artifacts
 */
@OptIn(UnstableApi::class)
class ReplayGainAudioProcessor : BaseAudioProcessor() {

    companion object {
        private const val TAG = "ReplayGainProcessor"
        private const val CLIP_REPORT_INTERVAL_MS = 50L // ~20Hz reporting
    }

    @Volatile
    private var gainLinear: Float = 1f
    @Volatile
    private var gainDb: Float = 0f
    @Volatile
    private var clippingCallback: ((peakOverDb: Float) -> Unit)? = null
    private var lastClipReportTime: Long = 0
    private var maxPeakLinear: Float = 0f
    private var hasLoggedFirstInput = false
    private var hasLoggedConfigure = false

    /**
     * Set the gain in decibels. Can be positive (boost) or negative (attenuate).
     * Thread-safe: can be called from any thread while audio is processing.
     */
    fun setGainDb(db: Float) {
        gainDb = db
        gainLinear = if (db == 0f) 1f else 10f.pow(db / 20f)
        Log.d(TAG, "setGainDb(${String.format("%.2f", db)}) -> linear=${String.format("%.4f", gainLinear)}")
    }

    /**
     * Set callback for clipping detection.
     * Called with peak dB over 0 dBFS whenever clipping is detected.
     * The callback is invoked on the audio rendering thread - post to main if needed.
     */
    fun setClippingCallback(callback: ((peakOverDb: Float) -> Unit)?) {
        clippingCallback = callback
    }

    /**
     * Reset the max peak tracker (e.g., on track change).
     */
    fun resetPeakTracker() {
        maxPeakLinear = 0f
        lastClipReportTime = 0
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (!hasLoggedConfigure) {
            hasLoggedConfigure = true
            Log.i(TAG, "onConfigure: encoding=${inputAudioFormat.encoding}, " +
                "sampleRate=${inputAudioFormat.sampleRate}, channelCount=${inputAudioFormat.channelCount}")
        }
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT ||
            inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            return inputAudioFormat
        }
        Log.w(TAG, "onConfigure: unsupported encoding ${inputAudioFormat.encoding}, returning NOT_SET")
        return AudioProcessor.AudioFormat.NOT_SET
    }

    override fun isActive(): Boolean {
        // Always active to ensure processor stays in the audio pipeline.
        // DefaultAudioSink.configure() checks isActive() once during initial audio format
        // setup - if it returns false, the processor is permanently excluded from the
        // active chain until the next format change. Returning true unconditionally
        // eliminates any timing/visibility issues. The cost of 1x gain multiply is negligible.
        return true
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val size = limit - position
        if (size == 0) return

        if (!hasLoggedFirstInput) {
            hasLoggedFirstInput = true
            Log.i(TAG, "queueInput FIRST CALL: encoding=${inputAudioFormat.encoding}, " +
                "gainLinear=${String.format("%.4f", gainLinear)}, gainDb=${String.format("%.2f", gainDb)}, " +
                "bytes=$size")
        }

        val output = replaceOutputBuffer(size)
        output.order(ByteOrder.nativeOrder())

        when (inputAudioFormat.encoding) {
            C.ENCODING_PCM_16BIT -> processPcm16(inputBuffer, output)
            C.ENCODING_PCM_FLOAT -> processPcmFloat(inputBuffer, output)
            else -> {
                // Passthrough for unsupported encodings
                val slice = inputBuffer.slice()
                slice.limit(size)
                output.put(slice)
                inputBuffer.position(limit)
            }
        }

        output.flip()
    }

    private fun processPcm16(input: ByteBuffer, output: ByteBuffer) {
        var maxAbsSample = 0f
        val gain = gainLinear

        while (input.remaining() >= 2) {
            val sample = input.short
            val floatSample = sample.toFloat() / Short.MAX_VALUE
            val gained = floatSample * gain

            // Track peak for clipping detection (before clamping)
            val absSample = abs(gained)
            if (absSample > maxAbsSample) maxAbsSample = absSample

            // Soft-clip: clamp to [-1, 1] to prevent harsh digital distortion
            val clamped = gained.coerceIn(-1f, 1f)
            output.putShort((clamped * Short.MAX_VALUE).toInt().toShort())
        }

        reportClipping(maxAbsSample)
    }

    private fun processPcmFloat(input: ByteBuffer, output: ByteBuffer) {
        var maxAbsSample = 0f
        val gain = gainLinear

        while (input.remaining() >= 4) {
            val sample = input.float
            val gained = sample * gain

            val absSample = abs(gained)
            if (absSample > maxAbsSample) maxAbsSample = absSample

            // Soft-clip: clamp to [-1, 1]
            val clamped = gained.coerceIn(-1f, 1f)
            output.putFloat(clamped)
        }

        reportClipping(maxAbsSample)
    }

    private fun reportClipping(maxAbsSample: Float) {
        if (maxAbsSample >= 1f && clippingCallback != null) {
            maxPeakLinear = maxOf(maxPeakLinear, maxAbsSample)
            val now = System.currentTimeMillis()
            if (now - lastClipReportTime >= CLIP_REPORT_INTERVAL_MS) {
                lastClipReportTime = now
                val peakOverDb = 20f * log10(maxPeakLinear)
                clippingCallback?.invoke(peakOverDb)
            }
        }
    }
}
