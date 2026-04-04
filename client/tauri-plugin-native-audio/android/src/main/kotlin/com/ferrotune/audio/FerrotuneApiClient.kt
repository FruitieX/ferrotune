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
    val password: String? = null,
    val apiKey: String? = null,
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
 * Response from GET /ferrotune/queue/current-window.
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
)

/**
 * Response from POST /ferrotune/queue/position, /shuffle, /repeat.
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
            "username=${config.username}, hasApiKey=${config.apiKey != null}, " +
            "sessionId=${config.sessionId}")
        sessionConfig = config
    }

    fun hasSessionConfig(): Boolean = sessionConfig != null

    fun updateSessionId(sessionId: String) {
        val config = sessionConfig
        if (config != null) {
            Log.d(TAG, "Updating sessionId: ${config.sessionId} -> $sessionId")
            sessionConfig = config.copy(sessionId = sessionId)
        } else {
            Log.w(TAG, "updateSessionId called but no session config set yet")
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
     * Return auth headers for HTTP requests (Basic auth or API key).
     * Used by ExoPlayer's data source factory for streaming/cover art.
     */
    fun getAuthHeaders(): Map<String, String> {
        val config = getConfig()
        return if (config.username != null && config.password != null) {
            val credentials = android.util.Base64.encodeToString(
                "${config.username}:${config.password}".toByteArray(),
                android.util.Base64.NO_WRAP
            )
            mapOf("Authorization" to "Basic $credentials")
        } else if (config.apiKey != null) {
            mapOf("X-Api-Key" to config.apiKey)
        } else {
            emptyMap()
        }
    }

    /**
     * Build a streaming URL for a song.
     */
    fun buildStreamUrl(songId: String, settings: PlaybackSettings, timeOffsetSeconds: Long = 0): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}/ferrotune/stream").buildUpon()
        appendCommonParams(uriBuilder)
        uriBuilder.appendQueryParameter("id", songId)
        if (settings.transcodingEnabled) {
            uriBuilder.appendQueryParameter("maxBitRate", settings.transcodingBitrate.toString())
            uriBuilder.appendQueryParameter("format", "opus")
        }
        if (timeOffsetSeconds > 0) {
            uriBuilder.appendQueryParameter("timeOffset", timeOffsetSeconds.toString())
        }
        return uriBuilder.build().toString()
    }

    /**
     * Build a cover art URL for a song.
     */
    fun buildCoverArtUrl(coverArtId: String, size: Int = 512): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}/ferrotune/cover-art").buildUpon()
        appendCommonParams(uriBuilder)
        uriBuilder.appendQueryParameter("id", coverArtId)
        uriBuilder.appendQueryParameter("size", size.toString())
        return uriBuilder.build().toString()
    }

    /**
     * Add auth headers for JSON API calls (Basic auth or API key).
     */
    private fun addAuthHeaders(requestBuilder: Request.Builder) {
        val config = getConfig()
        if (config.username != null && config.password != null) {
            val credentials = android.util.Base64.encodeToString(
                "${config.username}:${config.password}".toByteArray(),
                android.util.Base64.NO_WRAP
            )
            requestBuilder.addHeader("Authorization", "Basic $credentials")
        } else if (config.apiKey != null) {
            // API key in query param is handled at URL build time
            // For JSON API calls, use it as a query parameter
        }
    }

    /**
     * Build a URL for API calls with optional API key auth.
     */
    private fun buildApiUrl(path: String, queryParams: Map<String, String> = emptyMap()): String {
        val config = getConfig()
        val uriBuilder = Uri.parse("${config.serverUrl}$path").buildUpon()
        // Add API key to query params if using API key auth (no Basic auth)
        if (config.apiKey != null && (config.username == null || config.password == null)) {
            uriBuilder.appendQueryParameter("apiKey", config.apiKey)
        }
        queryParams.forEach { (k, v) -> uriBuilder.appendQueryParameter(k, v) }
        return uriBuilder.build().toString()
    }

    /**
     * GET /ferrotune/queue/current-window?radius=N
     */
    fun getQueueWindow(radius: Int = 20): GetQueueResponse {
        val config = getConfig()
        val params = mutableMapOf("radius" to radius.toString())
        config.sessionId?.let { params["sessionId"] = it }
        val url = buildApiUrl("/ferrotune/queue/current-window", params)
        val request = Request.Builder().url(url).get().also { addAuthHeaders(it) }.build()
        return executeRequest(request) { body -> parseGetQueueResponse(JSONObject(body)) }
    }

    /**
     * POST /ferrotune/queue/position
     */
    fun updatePosition(currentIndex: Int, positionMs: Long, reshuffle: Boolean = false): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("currentIndex", currentIndex)
            put("positionMs", positionMs)
            put("reshuffle", reshuffle)
            getConfig().sessionId?.let { put("sessionId", it) }
        }
        val url = buildApiUrl("/ferrotune/queue/position")
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
     * POST /ferrotune/queue/shuffle
     */
    fun toggleShuffle(enabled: Boolean): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("enabled", enabled)
            getConfig().sessionId?.let { put("sessionId", it) }
        }
        val url = buildApiUrl("/ferrotune/queue/shuffle")
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
     * POST /ferrotune/queue/repeat
     */
    fun setRepeatMode(mode: String): QueueSuccessResponse {
        val json = JSONObject().apply {
            put("mode", mode)
            getConfig().sessionId?.let { put("sessionId", it) }
        }
        val url = buildApiUrl("/ferrotune/queue/repeat")
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
     * POST /ferrotune/scrobbles
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
        val url = buildApiUrl("/ferrotune/scrobbles")
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
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "Scrobble network error for song $songId", e)
        }
    }

    /**
     * POST /ferrotune/sessions/:id/heartbeat
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
            put("isPlaying", isPlaying)
            if (currentIndex != null) put("currentIndex", currentIndex)
            if (positionMs != null) put("positionMs", positionMs)
            if (currentSongId != null) put("currentSongId", currentSongId)
            if (currentSongTitle != null) put("currentSongTitle", currentSongTitle)
            if (currentSongArtist != null) put("currentSongArtist", currentSongArtist)
        }
        val url = buildApiUrl("/ferrotune/sessions/$sessionId/heartbeat")
        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody(JSON_MEDIA_TYPE))
            .also { addAuthHeaders(it) }
            .build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Heartbeat failed: ${response.code}")
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "Heartbeat network error", e)
        }
    }

    private fun <T> executeRequest(request: Request, parser: (String) -> T): T {
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
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
            return
        }

        disconnectSSE()

        var sseUrl = buildApiUrl("/ferrotune/sessions/$sessionId/events")
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
                }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.w(TAG, "SSE disconnected (code=${response?.code})", t)
                listener.onDisconnected()
            }

            override fun onClosed(eventSource: EventSource) {
                Log.d(TAG, "SSE closed for session $sessionId")
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
                positionMs = if (json.has("positionMs") && !json.isNull("positionMs"))
                    json.getLong("positionMs") else null,
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
    data class PlaybackCommand(val action: String, val positionMs: Long?) : SessionEvent()
    data class PositionUpdate(
        val currentIndex: Int,
        val positionMs: Long,
        val isPlaying: Boolean,
        val currentSongId: String?,
    ) : SessionEvent()
    object ClientListChanged : SessionEvent()
    data class OwnerChanged(val ownerClientId: String?, val ownerClientName: String?) : SessionEvent()
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
