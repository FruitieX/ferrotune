package com.ferrotune.core.model

/**
 * Normalizes user-entered server addresses the same way the web client does:
 * trim whitespace, default to `http://`, and drop any trailing slash.
 */
object ServerUrl {
    fun normalize(raw: String): String {
        val trimmed = raw.trim()
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
        return withScheme.trimEnd('/')
    }
}
