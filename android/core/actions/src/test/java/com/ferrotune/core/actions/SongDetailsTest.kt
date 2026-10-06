package com.ferrotune.core.actions

import com.ferrotune.core.network.generated.SongResponse
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SongDetailsTest {

    private val song = SongResponse(
        id = "so-1",
        title = "Song",
        album = "Album",
        artist = "Artist",
        artistId = "ar-1",
        track = 3,
        discNumber = 2,
        year = 2011,
        size = 5_452_595,
        contentType = "audio/flac",
        suffix = "flac",
        duration = 245,
        bitRate = 980,
        path = "Artist/Album/03.flac",
        fullPath = "/music/Artist/Album/03.flac",
        created = "2024-03-05T10:00:00Z",
        type = "music",
        playCount = 1,
        userRating = 4,
        computedReplayGainTrackGain = -6.5,
    )

    @Test
    fun `rows follow the web details dialog and skip missing values`() {
        val rows = songDetailRows(song, Locale.US).associate { it.label to it.value }

        assertEquals("Disc 2, track 3", rows["Track"])
        assertEquals("4:05", rows["Duration"])
        assertEquals("FLAC", rows["Format"])
        assertEquals("980 kbps", rows["Bitrate"])
        assertEquals("5.2 MB", rows["Size"])
        assertEquals("March 5, 2024", rows["Added"])
        assertEquals("★★★★☆", rows["Rating"])
        assertEquals("1 play", rows["Play Count"])
        assertEquals("-6.50 dB", rows["Computed Gain"])
        assertEquals("/music/Artist/Album/03.flac", rows["File Path"])
        assertNull(rows["Genre"])
        assertNull(rows["Favorited"])
        assertNull(rows["Original Gain"])
    }

    @Test
    fun `only the id and path can be copied`() {
        val copyable = songDetailRows(song, Locale.US).filter { it.copyable }.map { it.label }
        assertEquals(listOf("Track ID", "File Path"), copyable)
    }
}
