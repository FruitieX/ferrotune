package com.ferrotune.core.media

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheKeyFactory

/**
 * Key for a full (not time-offset) `/api/stream` request in the LRU stream
 * cache, from the request's path and query; null for anything else. Keyed by
 * song, format, and bitrate: a stream may be cached in parts, and a part
 * encoded at one bitrate must never be continued with bytes of another.
 */
internal fun fullStreamCacheKey(path: String?, queryParameter: (String) -> String?): String? {
    if (path == null || !path.endsWith("/api/stream")) return null
    if (queryParameter("timeOffset") != null) return null
    val songId = queryParameter("id") ?: return null
    val format = queryParameter("format") ?: return "audio:$songId:original"
    return "audio:$songId:$format:${queryParameter("maxBitRate") ?: "default"}"
}

internal fun fullStreamCacheKey(uri: Uri): String? =
    fullStreamCacheKey(uri.path) { uri.getQueryParameter(it) }

/**
 * Cache keys for the LRU stream cache: [fullStreamCacheKey] for full streams,
 * ignoring the per-song key the download-cache layer above stamps on each
 * request, and [FerrotuneCacheKeyFactory]'s keys for everything else (cover
 * art, offsets).
 */
internal class StreamCacheKeyFactory(
    private val fallback: CacheKeyFactory = FerrotuneCacheKeyFactory(),
) : CacheKeyFactory {
    override fun buildCacheKey(dataSpec: DataSpec): String =
        fullStreamCacheKey(dataSpec.uri) ?: fallback.buildCacheKey(dataSpec)
}

/**
 * Lets the stream cache keep full streams the server sends while it is still
 * transcoding them (no Content-Length). ExoPlayer flags its requests "don't
 * cache if the length is unknown", meant for live streams, so those songs were
 * never cached: a skip, which drops every buffered song after the target,
 * downloaded them all again, and so did going back a track. The server's
 * transcodes are byte-identical between requests, so a partly cached one
 * continues cleanly with a range request.
 */
internal class CacheableStreamDataSource(private val upstream: DataSource) : DataSource by upstream {
    override fun open(dataSpec: DataSpec): Long {
        val cacheable = if (fullStreamCacheKey(dataSpec.uri) != null) {
            dataSpec.buildUpon()
                .setFlags(dataSpec.flags and DataSpec.FLAG_DONT_CACHE_IF_LENGTH_UNKNOWN.inv())
                .build()
        } else {
            dataSpec
        }
        return upstream.open(cacheable)
    }
}
