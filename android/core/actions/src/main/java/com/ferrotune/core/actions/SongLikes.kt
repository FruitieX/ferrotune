package com.ferrotune.core.actions

import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * How long after a like a tap undoes it instead of adding another: the
 * server's `LIKE_UNDO_WINDOW`, so tapping repeatedly never piles up likes.
 */
const val LIKE_UNDO_WINDOW_MS = 12 * 60 * 60 * 1000L

/** A song's like count and newest like (epoch ms). */
data class SongLikes(
    val count: Int,
    val lastLikedAtMs: Long?,
)

/** Parses the server's `lastLiked` (`2026-10-14T12:00:00.000Z`) to epoch ms. */
fun parseLikedAt(iso: String?): Long? {
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

/** "Like", "Like again (3)" or, within the undo window, "Undo like (3)". */
fun songLikeMenuLabel(likeCount: Int, recentlyLiked: Boolean): String {
    val count = if (likeCount > 0) " ($likeCount)" else ""
    return when {
        recentlyLiked -> "Undo like$count"
        likeCount > 0 -> "Like again$count"
        else -> "Like"
    }
}
