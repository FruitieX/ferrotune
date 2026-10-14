package com.ferrotune.core.media

import androidx.media3.common.C
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

class KnownDurationExtractorsTest {
    @Test
    fun unknownDurationStreamReportsTheKnownDuration() {
        val reported = initWith(SeekMap.Unseekable(C.TIME_UNSET), durationUs = 245_000_000L)

        assertEquals(245_000_000L, reported.durationUs)
        assertFalse(reported.isSeekable)
    }

    @Test
    fun seekMapsTheContainerAlreadyDescribesPassThrough() {
        val known = SeekMap.Unseekable(120_000_000L)
        assertSame(known, initWith(known, durationUs = 245_000_000L))

        val seekable = object : SeekMap {
            override fun isSeekable() = true
            override fun getDurationUs() = C.TIME_UNSET
            override fun getSeekPoints(timeUs: Long) = SeekMap.SeekPoints(androidx.media3.extractor.SeekPoint.START)
        }
        assertSame(seekable, initWith(seekable, durationUs = 245_000_000L))
    }

    @Test
    fun missingDurationLeavesTheStreamAlone() {
        val unknown = SeekMap.Unseekable(C.TIME_UNSET)
        assertSame(unknown, initWith(unknown, durationUs = 0))
    }

    @Test
    fun extractorNeverSeesTheStreamLength() {
        // With a length, the Ogg extractor re-requests the stream from its end
        // and then from the start to read the duration.
        val seenLengths = mutableListOf<Long>()
        val extractor = KnownDurationExtractor(
            object : Extractor {
                override fun sniff(input: ExtractorInput) = true
                override fun init(output: ExtractorOutput) = Unit
                override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
                    seenLengths += input.length
                    input.skipFully(1)
                    return Extractor.RESULT_CONTINUE
                }
                override fun seek(position: Long, timeUs: Long) = Unit
                override fun release() = Unit
            },
            durationUs = 245_000_000L,
        )
        val input = DefaultExtractorInput({ _, _, length -> length }, 0, 6_000_000)

        extractor.read(input, PositionHolder())
        extractor.read(input, PositionHolder())

        assertEquals(listOf(C.LENGTH_UNSET.toLong(), C.LENGTH_UNSET.toLong()), seenLengths)
        assertEquals(2L, input.position)
    }

    private fun initWith(seekMap: SeekMap, durationUs: Long): SeekMap {
        val extractor = KnownDurationExtractor(
            object : Extractor {
                override fun sniff(input: ExtractorInput) = true
                override fun init(output: ExtractorOutput) = output.seekMap(seekMap)
                override fun read(input: ExtractorInput, seekPosition: PositionHolder) = Extractor.RESULT_END_OF_INPUT
                override fun seek(position: Long, timeUs: Long) = Unit
                override fun release() = Unit
            },
            durationUs,
        )
        var reported: SeekMap? = null
        extractor.init(
            object : ExtractorOutput {
                override fun track(id: Int, type: Int): TrackOutput = error("unused")
                override fun endTracks() = Unit
                override fun seekMap(seekMap: SeekMap) {
                    reported = seekMap
                }
            },
        )
        return checkNotNull(reported)
    }
}
