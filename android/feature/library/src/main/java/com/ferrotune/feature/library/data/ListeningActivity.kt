package com.ferrotune.feature.library.data

import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.ManagedHistoryEntry
import com.ferrotune.core.network.generated.ManagedHistoryEntryKind
import com.ferrotune.core.network.paging.DEFAULT_PAGE_SIZE
import com.ferrotune.core.network.paging.OffsetPagingSource
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Recent plays, newest first: each listening session together with the
 * scrobble of the same play (`combine`), plus scrobbles without a session
 * (imports, other clients).
 */
class ListeningActivityPagingSource(
    private val apiProvider: FerrotuneApiProvider,
) : OffsetPagingSource<ManagedHistoryEntry>() {
    override val pageSize: Int = DEFAULT_PAGE_SIZE

    override suspend fun loadPage(offset: Int, count: Int): PageResult<ManagedHistoryEntry> {
        val response = apiProvider.requireApi().historyEntries(
            mapOf(
                "combine" to "true",
                "offset" to offset.toString(),
                "limit" to count.toString(),
            ),
        )
        return PageResult(response.items, response.total)
    }
}

/** The server's `2026-10-14T17:20:33.606Z` as epoch ms. */
fun parseEventAt(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return try {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .parse(iso)
            ?.time
    } catch (_: ParseException) {
        null
    }
}

/** "Today", "Yesterday", or a date ("Mon, Oct 12") for a day heading. */
fun activityDayLabel(
    eventAtMs: Long,
    nowMs: Long = System.currentTimeMillis(),
    zone: TimeZone = TimeZone.getDefault(),
    locale: Locale = Locale.getDefault(),
): String {
    fun dayIndex(ms: Long): Long {
        val calendar = Calendar.getInstance(zone).apply { timeInMillis = ms }
        return calendar.get(Calendar.YEAR) * 400L + calendar.get(Calendar.DAY_OF_YEAR)
    }
    val days = dayIndex(nowMs) - dayIndex(eventAtMs)
    return when (days) {
        0L -> "Today"
        1L -> "Yesterday"
        else -> {
            val sameYear = Calendar.getInstance(zone).apply { timeInMillis = nowMs }.get(Calendar.YEAR) ==
                Calendar.getInstance(zone).apply { timeInMillis = eventAtMs }.get(Calendar.YEAR)
            SimpleDateFormat(if (sameYear) "EEE, MMM d" else "EEE, MMM d, yyyy", locale)
                .apply { timeZone = zone }
                .format(Date(eventAtMs))
        }
    }
}

/** The play's time of day ("20:21"), in the device's 12/24 h style via [pattern]. */
fun activityTime(eventAtMs: Long, pattern: String = "HH:mm", zone: TimeZone = TimeZone.getDefault()): String =
    SimpleDateFormat(pattern, Locale.ROOT).apply { timeZone = zone }.format(Date(eventAtMs))

/**
 * What happened in a play: "Listened 3:02 of 3:03 • Scrobbled", "Listened
 * 0:08 of 3:41 • Skipped", or for a scrobble alone "Scrobbled" plus its
 * import label.
 */
fun activityDetails(entry: ManagedHistoryEntry): String = buildList {
    entry.durationSeconds?.let { listened ->
        add("Listened ${clock(listened.toLong())} of ${clock(entry.song.duration)}")
    }
    if (entry.skipped == true) add("Skipped")
    val scrobbled = entry.kind == ManagedHistoryEntryKind.SCROBBLE || entry.scrobbleId != null
    if (scrobbled) {
        val plays = entry.playCount ?: 1
        add(if (plays > 1) "Scrobbled ×$plays" else "Scrobbled")
    }
    entry.description?.takeIf { it.isNotBlank() }?.let(::add)
}.joinToString(" • ")

private fun clock(seconds: Long): String = "%d:%02d".format(Locale.ROOT, seconds / 60, seconds % 60)
