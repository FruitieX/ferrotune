package com.ferrotune.core.actions

import com.ferrotune.core.network.SongColumn
import com.ferrotune.core.network.generated.SongResponse
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SongColumnsTest {
    private val song = SongResponse(
        id = "so-1",
        title = "Song",
        artist = "Artist",
        artistId = "ar-1",
        year = 2011,
        genre = "Rock",
        size = 1,
        contentType = "audio/flac",
        suffix = "flac",
        duration = 245,
        bitRate = 980,
        path = "a.flac",
        created = "2024-03-05T10:00:00Z",
        type = "music",
        playCount = 12,
        userRating = 4,
        lastPlayed = "2026-10-01T08:00:00Z",
    )

    @Test
    fun `details list the enabled extra columns in a fixed order`() {
        val details = songColumnDetails(song, SongColumn.entries.toSet(), Locale.US)

        assertEquals(
            "2011 • Rock • 12 plays • ★ 4 • FLAC 980 kbps • Added Mar 5, 2024 • Played Oct 1, 2026",
            details,
        )
    }

    @Test
    fun `subtitle columns alone add no details line`() {
        assertNull(songColumnDetails(song, DefaultSongColumns, Locale.US))
    }

    @Test
    fun `unrated songs skip the rating but unplayed ones show zero plays`() {
        val details = songColumnDetails(
            song.copy(userRating = null, playCount = null),
            setOf(SongColumn.RATING, SongColumn.PLAY_COUNT),
            Locale.US,
        )

        assertEquals("0 plays", details)
    }
}
