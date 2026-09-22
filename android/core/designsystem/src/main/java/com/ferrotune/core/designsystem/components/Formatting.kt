package com.ferrotune.core.designsystem.components

/** Web `formatCount` (e.g. "5 songs"). */
fun formatCount(count: Int, singular: String, plural: String = "${singular}s"): String =
    "$count ${if (count == 1) singular else plural}"

/** Web `formatTotalDuration` (e.g. "1 hr 23 min", "45 min"). */
fun formatTotalDuration(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "$hours hr $minutes min" else "$minutes min"
}

/** Web `formatDurationMs` (e.g. "3:45", "1:02:03"); 0:00 for unknown durations. */
fun formatClockDuration(durationMs: Long): String {
    if (durationMs <= 0) return "0:00"
    val totalSeconds = durationMs / 1000
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    } else {
        "$minutes:${seconds.toString().padStart(2, '0')}"
    }
}

/** Web `formatListeningTime` (e.g. "42 minutes", "3 hr 15 min", "2 days 5 hr"). */
fun formatListeningTime(totalSeconds: Long): String {
    if (totalSeconds < 60) return "Less than a minute"

    val minutes = totalSeconds / 60
    val hours = minutes / 60
    val days = hours / 24

    if (days > 0) {
        val remainingHours = hours % 24
        return if (remainingHours > 0) {
            "$days day${if (days > 1) "s" else ""} $remainingHours hr"
        } else {
            "$days day${if (days > 1) "s" else ""}"
        }
    }

    if (hours > 0) {
        val remainingMinutes = minutes % 60
        return if (remainingMinutes > 0) {
            "$hours hr $remainingMinutes min"
        } else {
            "$hours hour${if (hours > 1) "s" else ""}"
        }
    }

    return "$minutes minute${if (minutes > 1) "s" else ""}"
}
