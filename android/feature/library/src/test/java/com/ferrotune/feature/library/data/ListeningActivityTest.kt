package com.ferrotune.feature.library.data

import com.ferrotune.core.network.generated.ManagedHistoryEntry
import com.ferrotune.core.network.generated.ManagedHistoryEntryKind
import com.ferrotune.core.network.generated.SongResponse
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Test

class ListeningActivityTest {
    private val song = SongResponse(
        id = "so-1",
        title = "Funk Express",
        artist = "Artist",
        artistId = "ar-1",
        size = 0,
        contentType = "audio/opus",
        suffix = "opus",
        duration = 183,
        path = "a.opus",
        created = "2026-01-01T00:00:00.000Z",
        type = "music",
    )

    private fun entry(
        kind: ManagedHistoryEntryKind,
        duration: Int? = null,
        scrobbleId: Long? = null,
        skipped: Boolean? = null,
        playCount: Long? = null,
        description: String? = null,
    ) = ManagedHistoryEntry(
        kind = kind,
        id = 1,
        eventAt = "2026-10-14T17:20:33.606Z",
        song = song,
        durationSeconds = duration,
        skipped = skipped,
        playCount = playCount,
        description = description,
        scrobbleId = scrobbleId,
    )

    @Test
    fun `a combined play reads as listened and scrobbled`() {
        assertEquals(
            "Listened 3:02 of 3:03 • Scrobbled",
            activityDetails(entry(ManagedHistoryEntryKind.SESSION, duration = 182, scrobbleId = 9)),
        )
        assertEquals(
            "Listened 0:08 of 3:03 • Skipped",
            activityDetails(entry(ManagedHistoryEntryKind.SESSION, duration = 8, skipped = true)),
        )
        assertEquals(
            "Scrobbled ×3 • Last.fm import",
            activityDetails(entry(ManagedHistoryEntryKind.SCROBBLE, playCount = 3, description = "Last.fm import")),
        )
    }

    @Test
    fun `plays are grouped under today, yesterday and dated days`() {
        val zone = TimeZone.getTimeZone("Europe/Helsinki")
        val now = parseEventAt("2026-10-14T17:20:33.606Z")!!
        assertEquals("Today", activityDayLabel(parseEventAt("2026-10-13T21:30:00.000Z")!!, now, zone, Locale.US))
        assertEquals("Yesterday", activityDayLabel(parseEventAt("2026-10-13T20:30:00.000Z")!!, now, zone, Locale.US))
        assertEquals("Sun, Oct 11", activityDayLabel(parseEventAt("2026-10-11T12:00:00.000Z")!!, now, zone, Locale.US))
        assertEquals("20:20", activityTime(now, "HH:mm", zone))
    }
}
