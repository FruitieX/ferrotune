package com.ferrotune.feature.feedback

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** App id this client reports under in feedback-hub's app registry. */
const val FEEDBACK_APP_ID = "ferrotune-android"

enum class FeedbackKind(val wire: String, val label: String) {
    Bug("bug", "Problem"),
    Idea("idea", "Idea"),
    Other("other", "Other"),
}

/**
 * One report for feedback-hub's `POST /api/feedback`. [screenshots] are data
 * URLs; [context] and [logs] are only filled when the user opts in to
 * diagnostics.
 */
data class FeedbackReport(
    val kind: FeedbackKind,
    val message: String,
    val reporter: String?,
    val page: String?,
    val userAgent: String?,
    val context: Map<String, String>,
    val logs: List<String>,
    val screenshots: List<String>,
)

fun FeedbackReport.toJson(): String = buildJsonObject {
    put("app", FEEDBACK_APP_ID)
    put("kind", kind.wire)
    put("message", message.trim())
    put("reporter", reporter?.trim()?.takeIf { it.isNotEmpty() })
    put("url", page)
    put("userAgent", userAgent)
    put("source", "android")
    put(
        "context",
        buildJsonObject {
            context.forEach { (key, value) -> put(key, value) }
            if (logs.isNotEmpty()) put("logs", JsonArray(logs.map(::JsonPrimitive)))
        },
    )
    put("screenshots", JsonArray(screenshots.map(::JsonPrimitive)))
}.toString()

/** Keeps the newest [max] non-blank logcat lines. */
fun recentLogLines(raw: String, max: Int = 60): List<String> =
    raw.lineSequence()
        .map { it.trimEnd() }
        .filter { it.isNotBlank() && !it.startsWith("--------- beginning of") }
        .toList()
        .takeLast(max)
        .map { it.take(500) }
