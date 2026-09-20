package com.ferrotune.core.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Builds an authenticated cover-art URL. Callers render it through an image
 * loader that attaches the active account's bearer token.
 */
fun coverArtUrl(serverUrl: String, coverArtId: String, size: String? = null): String? {
    val base = serverUrl.trimEnd('/').toHttpUrlOrNull() ?: return null
    return base.newBuilder()
        .addPathSegments("api/cover-art")
        .addQueryParameter("id", coverArtId)
        .apply { if (size != null) addQueryParameter("size", size) }
        .build()
        .toString()
}
