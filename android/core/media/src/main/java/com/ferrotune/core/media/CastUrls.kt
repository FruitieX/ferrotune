package com.ferrotune.core.media

/**
 * Appends a media URL token to an already-built API URL. Pure helper so the
 * Cast URL construction stays unit-testable.
 */
fun appendUrlToken(url: String, urlToken: String?): String {
    if (urlToken.isNullOrBlank()) return url
    if (url.contains("urlToken=")) return url
    val separator = if (url.contains('?')) '&' else '?'
    return "$url$separator" + "urlToken=$urlToken"
}

/** Content type hint for the Cast receiver based on the stream URL. */
fun castContentType(streamUrl: String): String =
    if (streamUrl.contains("format=opus")) "audio/ogg" else "audio/mpeg"
