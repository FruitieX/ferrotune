package com.ferrotune.core.media

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SniffFailure

/**
 * Extractors for a stream whose duration the app knows but the container
 * can't tell: a transcoded Ogg/Opus stream served while the server is still
 * encoding it (no Content-Length, so the Ogg extractor reports neither a
 * length nor a duration).
 *
 * ExoPlayer treats a stream of unknown length *and* duration as live. When
 * its connection breaks it can't resume from the byte it reached, so it plays
 * out the buffer and then restarts the item from 0 — the audible stop and
 * imprecise resume around network drops. Reporting the duration makes it
 * retry the load from the current byte offset (`Range: bytes=N-`) while the
 * buffered audio keeps playing.
 */
internal class KnownDurationExtractorsFactory(
    private val delegate: ExtractorsFactory,
    private val durationUs: Long,
) : ExtractorsFactory {
    override fun createExtractors(): Array<Extractor> = wrap(delegate.createExtractors())

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
        wrap(delegate.createExtractors(uri, responseHeaders))

    private fun wrap(extractors: Array<Extractor>): Array<Extractor> =
        Array(extractors.size) { KnownDurationExtractor(extractors[it], durationUs) }
}

internal class KnownDurationExtractor(
    private val delegate: Extractor,
    private val durationUs: Long,
) : Extractor {
    override fun sniff(input: ExtractorInput): Boolean = delegate.sniff(input)

    override fun getSniffFailureDetails(): List<SniffFailure> = delegate.sniffFailureDetails

    override fun init(output: ExtractorOutput) {
        delegate.init(
            object : ExtractorOutput by output {
                override fun seekMap(seekMap: SeekMap) {
                    output.seekMap(withKnownDuration(seekMap, durationUs))
                }
            },
        )
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int =
        delegate.read(input, seekPosition)

    override fun seek(position: Long, timeUs: Long) = delegate.seek(position, timeUs)

    override fun release() = delegate.release()

    override fun getUnderlyingImplementation(): Extractor = delegate.underlyingImplementation
}

/** Fills in [durationUs] for an unseekable seek map of unknown duration; leaves others alone. */
internal fun withKnownDuration(seekMap: SeekMap, durationUs: Long): SeekMap =
    if (durationUs > 0 && !seekMap.isSeekable && seekMap.durationUs == C.TIME_UNSET) {
        SeekMap.Unseekable(durationUs)
    } else {
        seekMap
    }
