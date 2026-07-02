package com.ferrotune.audio

import android.net.Uri
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Session configuration for connecting to the Ferrotune server.
 */
data class SessionConfig(
    val serverUrl: String,
    val username: String? = null,
    val sessionToken: String? = null,
    val sessionExpiresAt: String? = null,
    val sessionId: String? = null,
    val clientId: String? = null,
)

/**
 * Playback settings that affect how tracks are prepared.
 */
data class PlaybackSettings(
    val replayGainMode: String = "disabled",
    val replayGainOffset: Float = 0f,
    val scrobbleThreshold: Float = 0.5f,
    val transcodingEnabled: Boolean = false,
    val transcodingBitrate: Int = 128,
)

/**
 * Parsed song data from server queue window response.
 */
data class QueueSong(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val coverArt: String?,
    val duration: Int,
    val computedReplayGainTrackGain: Float?,
    val originalReplayGainTrackGain: Float?,
)

/**
 * A single entry in a queue window.
 */
data class QueueWindowEntry(
    val entryId: String,
    val position: Int,
    val song: QueueSong,
)

/**
 * Queue window returned by the server.
 */
data class QueueWindow(
    val offset: Int,
    val songs: List<QueueWindowEntry>,
)

/**
 * Response from GET /api/queue/current-window.
 */
data class GetQueueResponse(
    val sourceType: String? = null,
    val sourceId: String? = null,
    val totalCount: Int,
    val currentIndex: Int,
    val positionMs: Long,
    val isShuffled: Boolean,
    val repeatMode: String,
    val window: QueueWindow,
    /** Optimistic concurrency version — incremented on each queue mutation. */
    val version: Long = 0,
)

/**
 * Response from POST /api/queue/position, /shuffle, /repeat.
 */
data class QueueSuccessResponse(
    val success: Boolean,
    val newIndex: Int? = null,
    val totalCount: Int? = null,
)

/**
 * HTTP client for communicating with the Ferrotune server API.
 * Uses OkHttp (already available via ExoPlayer/Media3 dependency).
 */
class FerrotuneApiClient {

    companion object {
        private const val TAG = "FerrotuneApiClient"
        private const val CLIENT_NAME = "ferrotune-mobile"
        private const val API_VERSION = "1.16.1"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var sessionConfig: SessionConfig? = null

    fun setSessionConfig(config: SessionConfig) {
        Log.d(TAG, "Session configured: serverUrl=${config.serverUrl}, " +
            "username=${config.username}, hasSessionToken=${config.sessionToken != null}, " +
            "hasSessionExpiresAt=${config.sessionExpiresAt != null}, sessionId=${config.sessionId}")
        NativeAudioLogger.info(
            TAG,
            "api_session_configured",
            "Ferrotune API session configured",
            mapOf(
                "serverUrl" to config.serverUrl,
                "username" to config.username,
                "hasSessionToken" to (config.sessionToken != null),
                "hasSessionExpiresAt" to (config.sessionExpiresAt != null),
                "sessionId" to config.sessionId,
                "clientId" to config.clientId,
            ),
        )
        sessionConfig = config
    }

    fun clearSessionConfig() {
        NativeAudioLogger.info(TAG, "api_session_cleared", "Ferrotune API session config cleared")
        sessionConfig = null
    }

    fun hasSessionConfig(): Boolean = sessionConfig != null

    fun getClientId(): String? = sessionConfig?.clientId

    fun updateSessionId(sessionId: String) {
        val config = sessionConfig
        if (config != null) {
            Log.d(TAG, "Updating sessionId: ${config.sessionId} -> $sessionId")
            NativeAudioLogger.info(
                TAG,
                "api_session_id_updated",
                "Ferrotune API session id updated",
                mapOf("oldSessionId" to config.sessionId, "newSessionId" to sessionId),
            )
            sessionConfig = config.copy(sessionId = sessionId)
        } else {
            Log.w(TAG, "updateSessionId called but no session config set yet")
            NativeAudioLogger.warn(TAG, "api_session_id_update_ignored", "updateSessionId called without session config")
        }
    }

    private fun getConfig(): SessionConfig {
        return sessionConfig ?: throw IllegalStateException("Session not configured - call initSession first")
    }

    /**
     * Build non-auth query parameters for URLs (streaming, cover art).
     * Auth is sent via HTTP headers instead of query params to avoid
     * credentials leaking into logs, proxies, and cache keys.
     */
    private fun appendCommonParams(uriBuilder: Uri.Builder) {
        uriBuilder.appendQueryParameter("v", API_VERSION)
        uriBuilder.appendQueryParameter("c", CLIENT_NAME)
    }

    /**
    * Return auth headers for HTTP requests.
     * Used by ExoPlayer's data source factory for streaming/cover art.
     */
    fun getAuthHeaders(): Map<String, String> {
        val config = getConfig()
        return if (config.sessionToken != null) {
            mapOf("Authorization" to "Bearer ${config.sessionToken}")
        } else {
            emptyMap()
        }
    }

    /**
     * Build a streaming URL for a song.
     */
    fun buildStreamUrl(songId: String, settings: PlaybackSettings, timeOffsetSeconds: Long = 0): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}/api/stream").buildUpon()
        appendCommonParams(uriBuilder)
        uriBuilder.appendQueryParameter("id", songId)
        if (settings.transcodingEnabled) {
            uriBuilder.appendQueryParameter("maxBitRate", settings.transcodingBitrate.toString())
            uriBuilder.appendQueryParameter("format", "opus")
        }
        if (timeOffsetSeconds > 0) {
            uriBuilder.appendQueryParameter("timeOffset", timeOffsetSeconds.toString())
        }
        NativeAudioLogger.debug(
            TAG,
            "stream_url_built",
            "Built native stream URL metadata",
            mapOf(
                "songId" to songId,
                "transcoding" to settings.transcodingEnabled,
                "bitrate" to settings.transcodingBitrate,
                "format" to if (settings.transcodingEnabled) "opus" else null,
                "timeOffsetSeconds" to timeOffsetSeconds,
                "hasAuthHeader" to (config.sessionToken != null),
            ),
        )
        return uriBuilder.build().toString()
    }

    /**
     * Build a cover art URL for a song.
     */
    fun buildCoverArtUrl(coverArtId: String, size: Int = 1024): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}/api/cover-art").buildUpon()
        appendCommonParams(uriBuilder)
        uriBuilder.appendQueryParameter("id", coverArtId)
        uriBuilder.appendQueryParameter("size", size.toString())
        return uriBuilder.build().toString()
    }

    /**
     * Build a stream URL for offline download.
     *
     * Unlike [buildStreamUrl], this honors the user's download-quality settings
     * (independent of the streaming transcoding settings). When [format] is
     * "opus", the URL carries `format=opus` and `maxBitRate=<maxBitRate>` so
     * the backend serves a single complete transcoded Opus file. When
     * [format] is "original", no transcoding parameters are appended and the
     * backend serves the source file as-is.
     */
    fun buildDownloadStreamUrl(songId: String, format: String, maxBitRate: Int?): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}/api/stream").buildUpon()
        appendCommonParams(uriBuilder)
        uriBuilder.appendQueryParameter("id", songId)
        if (format.lowercase() == "opus" && maxBitRate != null) {
            uriBuilder.appendQueryParameter("maxBitRate", maxBitRate.toString())
            uriBuilder.appendQueryParameter("format", "opus")
        }
        NativeAudioLogger.debug(
            TAG,
            "download_stream_url_built",
            "Built download stream URL metadata",
            mapOf(
                "songId" to songId,
                "format" to format,
                "maxBitRate" to maxBitRate,
                "hasAuthHeader" to (config.sessionToken != null),
            ),
        )
        return uriBuilder.build().toString()
    }

    /**
    * Add auth headers for JSON API calls.
     */
    private fun addAuthHeaders(requestBuilder: Request.Builder) {
        val config = getConfig()
        if (config.sessionToken != null) {
            requestBuilder.addHeader("Authorization", "Bearer ${config.sessionToken}")
        }
    }

    /**
    * Build a URL for API calls.
     */
    private fun buildApiUrl(path: String, queryParams: Map<String, String> = emptyMap()): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}$path").buildUpon()
        queryParams.forEach { (k, v) -> uriBuilder.appendQueryParameter(k, v) }
        return uriBuilder.build().toString()
    }

    /**
     * GET /api/queue/current-window?radius=N
     */
    fun getQueueWindow(radius: Int = 20): GetQueueResponse {
        val config = getConfig()
        val params = mutableMapOf("radius" to radius.toString())
        config.sessionId?.let { params["sessionId"] = it }
        val url = buildApiUrl("/api/queue/current-window", params)
        val request = Request.Builder().url(url).get().also { addAuthHeaders(it) }.build()
        return executeRequest(request) { body -> parseGetQueueResponse(JSONObject(body)) }
    }

    /**
     * POST /api/queue/position
     */
    fun updatePosition(currentIndex: Int, positionMs: Long, reshuffle: Boolean = false): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("currentIndex", currentIndex)
            put("positionMs", positionMs)
            put("reshuffle", reshuffle)
            val config = getConfig()
            config.sessionId?.let { put("sessionId", it) }
            config.clientId?.let { put("clientId", it) }
        }
        val url = buildApiUrl("/api/queue/position")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        return executeRequest(request) { body ->
            val obj = JSONObject(body)
            QueueSuccessResponse(
                success = obj.optBoolean("success", true),
                newIndex = if (obj.has("newIndex")) obj.getInt("newIndex") else null,
                totalCount = if (obj.has("totalCount")) obj.getInt("totalCount") else null,
            )
        }
    }

    /**
     * POST /api/queue/shuffle
     */
    fun toggleShuffle(enabled: Boolean): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("enabled", enabled)
            getConfig().sessionId?.let { put("sessionId", it) }
        }
        val url = buildApiUrl("/api/queue/shuffle")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        return executeRequest(request) { body ->
            val obj = JSONObject(body)
            QueueSuccessResponse(
                success = obj.optBoolean("success", true),
                newIndex = if (obj.has("newIndex")) obj.getInt("newIndex") else null,
                totalCount = if (obj.has("totalCount")) obj.getInt("totalCount") else null,
            )
        }
    }

    /**
     * POST /api/queue/repeat
     */
    fun setRepeatMode(mode: String): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("mode", mode)
            getConfig().sessionId?.let { put("sessionId", it) }
        }
        val url = buildApiUrl("/api/queue/repeat")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        return executeRequest(request) { body ->
            val obj = JSONObject(body)
            QueueSuccessResponse(
                success = obj.optBoolean("success", true),
            )
        }
    }

    /**
     * POST /api/scrobbles
     */
    fun scrobble(
        songId: String,
        timeMs: Long? = null,
        submission: Boolean = true,
        queueSourceType: String? = null,
        queueSourceId: String? = null,
    ) {
        val json = JSONObject().apply {
            put("id", songId)
            if (timeMs != null) put("time", timeMs)
            put("submission", submission)
            if (queueSourceType != null) put("queueSourceType", queueSourceType)
            if (queueSourceId != null) put("queueSourceId", queueSourceId)
        }
        val url = buildApiUrl("/api/scrobbles")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        // Scrobble returns 204 No Content
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Scrobble failed: ${response.code} for song $songId")
                    NativeAudioLogger.warn(
                        TAG,
                        "scrobble_failed",
                        "Scrobble failed",
                        mapOf("songId" to songId, "httpStatus" to response.code),
                    )
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "Scrobble network error for song $songId", e)
            NativeAudioLogger.warn(
                TAG,
                "scrobble_network_error",
                "Scrobble network error",
                mapOf("songId" to songId),
                e,
            )
        }
    }

    /**
     * POST /api/sessions/:id/heartbeat
     * Sends playback state to the server so followers see correct is_playing.
     */
    fun sendHeartbeat(
        isPlaying: Boolean,
        currentIndex: Int? = null,
        positionMs: Long? = null,
        currentSongId: String? = null,
        currentSongTitle: String? = null,
        currentSongArtist: String? = null,
    ) {
        val config = getConfig()
        val sessionId = config.sessionId ?: return
        val json = JSONObject().apply {
            config.clientId?.let { put("clientId", it) }
            put("isPlaying", isPlaying)
            if (currentIndex != null) put("currentIndex", currentIndex)
            if (positionMs != null) put("positionMs", positionMs)
            if (currentSongId != null) put("currentSongId", currentSongId)
            if (currentSongTitle != null) put("currentSongTitle", currentSongTitle)
            if (currentSongArtist != null) put("currentSongArtist", currentSongArtist)
        }
        val url = buildApiUrl("/api/sessions/$sessionId/heartbeat")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Heartbeat failed: ${response.code}")
                    NativeAudioLogger.warn(
                        TAG,
                        "heartbeat_failed",
                        "Playback heartbeat failed",
                        mapOf(
                            "sessionId" to sessionId,
                            "httpStatus" to response.code,
                            "currentIndex" to currentIndex,
                            "positionMs" to positionMs,
                            "currentSongId" to currentSongId,
                        ),
                    )
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "Heartbeat network error", e)
            NativeAudioLogger.warn(
                TAG,
                "heartbeat_network_error",
                "Playback heartbeat network error",
                mapOf(
                    "sessionId" to sessionId,
                    "currentIndex" to currentIndex,
                    "positionMs" to positionMs,
                    "currentSongId" to currentSongId,
                ),
                e,
            )
        }
    }

    /**
     * DELETE /api/sessions/:id/clients/:clientId.
     *
     * Explicitly disconnect this client from the session so the server removes
     * it from the connected-clients list immediately, instead of waiting for
     * the ~90s heartbeat grace period to elapse after the SSE stream drops.
     *
     * Best-effort fire-and-forget during service teardown.
     */
    fun disconnectClient() {
        val config = sessionConfig ?: return
        val sessionId = config.sessionId ?: return
        val clientId = config.clientId ?: return
        val encodedClientId = java.net.URLEncoder.encode(clientId, "UTF-8")
        val url = buildApiUrl(
            "/api/sessions/$sessionId/clients/$encodedClientId",
            mapOf("clientId" to clientId),
        )
        val request = Request.Builder()
            .url(url)
            .delete()
            .also { addAuthHeaders(it) }
            .build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "disconnectClient failed: ${response.code}")
                    NativeAudioLogger.warn(
                        TAG,
                        "disconnect_client_failed",
                        "Session client disconnect failed",
                        mapOf(
                            "sessionId" to sessionId,
                            "clientId" to clientId,
                            "httpStatus" to response.code,
                        ),
                    )
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "disconnectClient network error", e)
            NativeAudioLogger.warn(
                TAG,
                "disconnect_client_network_error",
                "Session client disconnect network error",
                mapOf(
                    "sessionId" to sessionId,
                    "clientId" to clientId,
                ),
                e,
            )
        }
    }

    /**
     * POST /api/sessions/:id/command with action=takeOver.
     * Used by native media controls when the WebView is not initiating playback.
     */
    fun takeOver(positionMs: Long? = null, currentIndex: Int? = null) {
        val config = sessionConfig ?: return
        val sessionId = config.sessionId ?: return
        val clientId = config.clientId ?: return
        val json = JSONObject().apply {
            put("action", "takeOver")
            put("clientName", "ferrotune-mobile")
            put("clientId", clientId)
            if (positionMs != null) put("positionMs", positionMs)
            if (currentIndex != null) put("currentIndex", currentIndex)
        }
        val url = buildApiUrl("/api/sessions/$sessionId/command")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "takeOver failed: ${response.code}")
                    NativeAudioLogger.warn(
                        TAG,
                        "takeover_failed",
                        "Session takeOver command failed",
                        mapOf(
                            "sessionId" to sessionId,
                            "clientId" to clientId,
                            "httpStatus" to response.code,
                            "positionMs" to positionMs,
                            "currentIndex" to currentIndex,
                        ),
                    )
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "takeOver network error", e)
            NativeAudioLogger.warn(
                TAG,
                "takeover_network_error",
                "Session takeOver network error",
                mapOf(
                    "sessionId" to sessionId,
                    "clientId" to clientId,
                    "positionMs" to positionMs,
                    "currentIndex" to currentIndex,
                ),
                e,
            )
        }
    }

    private fun <T> executeRequest(request: Request, parser: (String) -> T): T {
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                NativeAudioLogger.warn(
                    TAG,
                    "api_request_failed",
                    "Ferrotune API request failed",
                    mapOf(
                        "method" to request.method,
                        "path" to request.url.encodedPath,
                        "httpStatus" to response.code,
                        "message" to response.message,
                    ),
                )
                throw IOException("API request failed: ${response.code} ${response.message} for ${request.url}")
            }
            val body = response.body?.string() ?: throw IOException("Empty response body")
            return parser(body)
        }
    }

    private fun parseGetQueueResponse(json: JSONObject): GetQueueResponse {
        val windowJson = json.getJSONObject("window")
        val songsArray = windowJson.getJSONArray("songs")
        val songs = mutableListOf<QueueWindowEntry>()
        for (i in 0 until songsArray.length()) {
            val entry = songsArray.getJSONObject(i)
            val songJson = entry.getJSONObject("song")
            songs.add(QueueWindowEntry(
                entryId = entry.getString("entryId"),
                position = entry.getInt("position"),
                song = parseSong(songJson),
            ))
        }
        val sourceJson = json.optJSONObject("source")
        return GetQueueResponse(
            sourceType = sourceJson?.optString("type")?.ifEmpty { null },
            sourceId = sourceJson?.optString("id")?.ifEmpty { null },
            totalCount = json.getInt("totalCount"),
            currentIndex = json.getInt("currentIndex"),
            positionMs = json.optLong("positionMs", 0),
            isShuffled = json.optBoolean("isShuffled", false),
            repeatMode = json.optString("repeatMode", "off"),
            window = QueueWindow(
                offset = windowJson.getInt("offset"),
                songs = songs,
            ),
            version = json.optLong("version", 0),
        )
    }

    private fun parseSong(json: JSONObject): QueueSong {
        return QueueSong(
            id = json.getString("id"),
            title = json.optString("title", "Unknown"),
            artist = json.optString("artist", "Unknown Artist"),
            album = json.optString("album", "Unknown Album"),
            coverArt = json.optString("coverArt").ifEmpty { null },
            duration = json.optInt("duration", 0),
            computedReplayGainTrackGain = if (json.has("computedReplayGainTrackGain") && !json.isNull("computedReplayGainTrackGain"))
                json.getDouble("computedReplayGainTrackGain").toFloat() else null,
            originalReplayGainTrackGain = if (json.has("originalReplayGainTrackGain") && !json.isNull("originalReplayGainTrackGain"))
                json.getDouble("originalReplayGainTrackGain").toFloat() else null,
        )
    }

    /**
     * Convert a QueueSong to a TrackInfo with computed ReplayGain and URLs.
     */
    fun songToTrackInfo(song: QueueSong, settings: PlaybackSettings): TrackInfo {
        val replayGainDb = computeReplayGainDb(song, settings)
        return TrackInfo(
            id = song.id,
            url = buildStreamUrl(song.id, settings),
            title = song.title,
            artist = song.artist,
            album = song.album,
            coverArtUrl = song.coverArt?.let { buildCoverArtUrl(it) },
            durationMs = song.duration.toLong() * 1000,
            replayGainDb = replayGainDb,
        )
    }

    /**
     * Compute ReplayGain dB value from song data and user settings.
     * Same logic as JS: computed preferred → original fallback → 0, plus offset.
     */
    fun computeReplayGainDb(song: QueueSong, settings: PlaybackSettings): Float? {
        if (settings.replayGainMode == "disabled") return null
        val trackGain = if (settings.replayGainMode == "original") {
            song.originalReplayGainTrackGain ?: 0f
        } else {
            song.computedReplayGainTrackGain
                ?: song.originalReplayGainTrackGain
                ?: 0f
        }
        return trackGain + settings.replayGainOffset
    }

    // =========================================================================
    // SSE — real-time session events
    // =========================================================================

    private val sseClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // no read timeout for SSE
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private var currentEventSource: EventSource? = null

    /**
     * Connect to the SSE stream for the configured session.
     * Delivers parsed [SessionEvent]s to [listener].
     * Call [disconnectSSE] to close.
     */
    fun connectSSE(listener: SessionEventListener) {
        val config = getConfig()
        val sessionId = config.sessionId ?: run {
            Log.w(TAG, "connectSSE: no sessionId configured, skipping")
            NativeAudioLogger.warn(TAG, "sse_connect_skipped", "connectSSE skipped: no sessionId configured")
            return
        }

        disconnectSSE()

        var sseUrl = buildApiUrl("/api/sessions/$sessionId/events")
        // Append clientId and clientName as query params for client registration
        val separator = if (sseUrl.contains("?")) "&" else "?"
        val params = mutableListOf<String>()
        config.clientId?.let { params.add("clientId=${java.net.URLEncoder.encode(it, "UTF-8")}") }
        params.add("clientName=ferrotune-mobile")
        sseUrl += separator + params.joinToString("&")

        val request = Request.Builder().url(sseUrl).get().also { addAuthHeaders(it) }.build()

        val factory = EventSources.createFactory(sseClient)
        currentEventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                Log.d(TAG, "SSE connected for session $sessionId")
                NativeAudioLogger.info(
                    TAG,
                    "sse_open",
                    "SSE connected",
                    mapOf("sessionId" to sessionId, "httpStatus" to response.code),
                )
                listener.onConnected()
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (data == "keep-alive" || data.isBlank()) return
                try {
                    val event = parseSessionEvent(JSONObject(data))
                    if (event != null) {
                        listener.onEvent(event)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "SSE: failed to parse event: $data", e)
                    NativeAudioLogger.warn(
                        TAG,
                        "sse_parse_failed",
                        "SSE event parse failed",
                        mapOf("sessionId" to sessionId, "eventType" to type, "eventId" to id),
                        e,
                    )
                }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.w(TAG, "SSE disconnected (code=${response?.code})", t)
                NativeAudioLogger.warn(
                    TAG,
                    "sse_failure",
                    "SSE disconnected",
                    mapOf("sessionId" to sessionId, "httpStatus" to response?.code),
                    t,
                )
                listener.onDisconnected()
            }

            override fun onClosed(eventSource: EventSource) {
                Log.d(TAG, "SSE closed for session $sessionId")
                NativeAudioLogger.info(TAG, "sse_closed", "SSE closed", mapOf("sessionId" to sessionId))
                listener.onDisconnected()
            }
        })
    }

    fun disconnectSSE() {
        currentEventSource?.cancel()
        currentEventSource = null
    }

    private fun parseSessionEvent(json: JSONObject): SessionEvent? {
        return when (json.optString("type")) {
            "queueChanged" -> SessionEvent.QueueChanged
            "queueUpdated" -> SessionEvent.QueueUpdated
            "playbackCommand" -> SessionEvent.PlaybackCommand(
                action = json.getString("action"),
                clientId = json.optString("clientId").ifEmpty { null },
                positionMs = if (json.has("positionMs") && !json.isNull("positionMs"))
                    json.getLong("positionMs") else null,
                currentIndex = if (json.has("currentIndex") && !json.isNull("currentIndex"))
                    json.getInt("currentIndex") else null,
            )
            "positionUpdate" -> SessionEvent.PositionUpdate(
                currentIndex = json.getInt("currentIndex"),
                positionMs = json.getLong("positionMs"),
                isPlaying = json.getBoolean("isPlaying"),
                currentSongId = json.optString("currentSongId").ifEmpty { null },
            )
            "sessionEnded" -> null // No longer emitted; sessions are permanent
            "sessionListChanged" -> null // Replaced by clientListChanged
            "clientListChanged" -> SessionEvent.ClientListChanged
            "ownerChanged" -> SessionEvent.OwnerChanged(
                ownerClientId = json.optString("ownerClientId").ifEmpty { null },
                ownerClientName = json.optString("ownerClientName").ifEmpty { null },
                resumePlayback = if (json.has("resumePlayback") && !json.isNull("resumePlayback"))
                    json.getBoolean("resumePlayback") else false,
                positionMs = if (json.has("positionMs") && !json.isNull("positionMs"))
                    json.getLong("positionMs") else null,
            )
            "volumeChange" -> SessionEvent.VolumeChange(
                volume = json.getDouble("volume").toFloat(),
                isMuted = json.getBoolean("isMuted"),
            )
            else -> {
                Log.w(TAG, "SSE: unknown event type: ${json.optString("type")}")
                null
            }
        }
    }
}

/**
 * Parsed session events from the SSE stream.
 */
sealed class SessionEvent {
    object QueueChanged : SessionEvent()
    object QueueUpdated : SessionEvent()
    data class PlaybackCommand(
        val action: String,
        val clientId: String?,
        val positionMs: Long?,
        val currentIndex: Int?,
    ) : SessionEvent()
    data class PositionUpdate(
        val currentIndex: Int,
        val positionMs: Long,
        val isPlaying: Boolean,
        val currentSongId: String?,
    ) : SessionEvent()
    object ClientListChanged : SessionEvent()
    data class OwnerChanged(
        val ownerClientId: String?,
        val ownerClientName: String?,
        val resumePlayback: Boolean,
        val positionMs: Long?,
    ) : SessionEvent()
    data class VolumeChange(val volume: Float, val isMuted: Boolean) : SessionEvent()
}

/**
 * Listener for SSE session events.
 */
interface SessionEventListener {
    fun onConnected()
    fun onEvent(event: SessionEvent)
    fun onDisconnected()
}
