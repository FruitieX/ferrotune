package com.ferrotune.core.media.cast

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.CastState
import com.google.android.gms.cast.framework.CastStateListener
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** A single queue item handed to the Cast receiver. */
data class CastMediaItem(
    val songId: String,
    val url: String,
    val contentType: String,
    val title: String,
    val artist: String,
    val album: String?,
    val coverArtUrl: String?,
    val durationMs: Long,
    val position: Int,
)

data class CastConnectionState(
    val available: Boolean = false,
    val connectionState: String = STATE_UNAVAILABLE,
    val deviceName: String? = null,
) {
    val isConnected: Boolean get() = connectionState == STATE_CONNECTED

    companion object {
        const val STATE_UNAVAILABLE = "unavailable"
        const val STATE_AVAILABLE = "available"
        const val STATE_CONNECTING = "connecting"
        const val STATE_CONNECTED = "connected"
    }
}

data class CastMediaStatus(
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val songId: String? = null,
    val queuePosition: Int? = null,
    val title: String? = null,
    val artist: String? = null,
    val volume: Double = 1.0,
    val isMuted: Boolean = false,
)

/**
 * StateFlow-based Cast sender. Port of the legacy `NativeCastManager` without
 * the hidden route-button hack: the UI owns a `MediaRouteButton` and this
 * manager only tracks session state and drives the remote media client.
 */
@Singleton
class CastManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val handler = Handler(Looper.getMainLooper())

    private val _state = MutableStateFlow(CastConnectionState())
    val state: StateFlow<CastConnectionState> = _state.asStateFlow()

    private val _status = MutableStateFlow(CastMediaStatus())
    val status: StateFlow<CastMediaStatus> = _status.asStateFlow()

    @Volatile
    private var initialized = false

    private var castContext: CastContext? = null
    private var remoteMediaClient: RemoteMediaClient? = null
    private var statusUpdatesRunning = false

    private val statusUpdateRunnable = object : Runnable {
        override fun run() {
            if (!statusUpdatesRunning) return
            emitMediaStatus()
            handler.postDelayed(this, STATUS_UPDATE_INTERVAL_MS)
        }
    }

    private val castStateListener = CastStateListener { emitStateChanged() }

    private val remoteMediaClientCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() = emitMediaStatus()
        override fun onMetadataUpdated() = emitMediaStatus()
        override fun onQueueStatusUpdated() = emitMediaStatus()
    }

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) = emitStateChanged()

        override fun onSessionStarted(session: CastSession, sessionId: String) {
            attachRemoteMediaClient(session.remoteMediaClient)
            emitStateChanged()
            emitMediaStatus()
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            Log.w(TAG, "Cast session start failed: $error")
            emitStateChanged()
        }

        override fun onSessionEnding(session: CastSession) = emitStateChanged()

        override fun onSessionEnded(session: CastSession, error: Int) {
            detachRemoteMediaClient()
            emitStateChanged()
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) =
            emitStateChanged()

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            attachRemoteMediaClient(session.remoteMediaClient)
            emitStateChanged()
            emitMediaStatus()
        }

        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            detachRemoteMediaClient()
            emitStateChanged()
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) = emitStateChanged()
    }

    fun initialize() {
        handler.post {
            if (initialized) return@post
            initialized = true
            try {
                val context = CastContext.getSharedInstance(this.context.applicationContext)
                castContext = context
                context.addCastStateListener(castStateListener)
                context.sessionManager.addSessionManagerListener(
                    sessionListener,
                    CastSession::class.java,
                )
                attachRemoteMediaClient(context.sessionManager.currentCastSession?.remoteMediaClient)
                emitStateChanged()
            } catch (e: Exception) {
                Log.w(TAG, "Cast framework unavailable", e)
                _state.value = CastConnectionState(
                    available = false,
                    connectionState = CastConnectionState.STATE_UNAVAILABLE,
                )
            }
        }
    }

    fun refresh() {
        handler.post {
            emitStateChanged()
            emitMediaStatus()
        }
    }

    fun endSession() {
        handler.post { castContext?.sessionManager?.endCurrentSession(true) }
    }

    suspend fun loadQueue(
        items: List<CastMediaItem>,
        startIndex: Int,
        startTimeMs: Long,
        repeatMode: String,
    ): Boolean = withContext(Dispatchers.Main) {
        if (items.isEmpty()) return@withContext false
        val client = currentRemoteMediaClient() ?: return@withContext false
        val castItems = items.map { item ->
            MediaQueueItem.Builder(buildMediaInfo(item))
                .setAutoplay(true)
                .setCustomData(buildCustomData(item))
                .build()
        }.toTypedArray()
        val safeIndex = startIndex.coerceIn(0, items.lastIndex)
        suspendCancellableCoroutine { continuation ->
            client.queueLoad(
                castItems,
                safeIndex,
                castRepeatMode(repeatMode),
                startTimeMs,
                null,
            ).setResultCallback { result ->
                if (continuation.isActive) {
                    continuation.resume(result.status.isSuccess) { _, _, _ -> }
                }
            }
        }
    }

    fun play() {
        handler.post {
            currentRemoteMediaClient()?.play()
            emitMediaStatus()
        }
    }

    fun pause() {
        handler.post {
            currentRemoteMediaClient()?.pause()
            emitMediaStatus()
        }
    }

    fun next() {
        handler.post {
            currentRemoteMediaClient()?.queueNext(null)
            emitMediaStatus()
        }
    }

    fun previous() {
        handler.post {
            currentRemoteMediaClient()?.queuePrev(null)
            emitMediaStatus()
        }
    }

    fun stop() {
        handler.post {
            currentRemoteMediaClient()?.stop()
            emitMediaStatus()
        }
    }

    fun seek(positionMs: Long) {
        handler.post {
            currentRemoteMediaClient()?.seek(
                MediaSeekOptions.Builder()
                    .setPosition(positionMs)
                    .setResumeState(MediaSeekOptions.RESUME_STATE_PLAY)
                    .build(),
            )
            emitMediaStatus()
        }
    }

    fun setVolume(volume: Float, muted: Boolean) {
        handler.post {
            val session = castContext?.sessionManager?.currentCastSession ?: return@post
            runCatching {
                session.volume = volume.coerceIn(0f, 1f).toDouble()
                session.isMute = muted
            }.onFailure { Log.w(TAG, "Failed to set Cast volume", it) }
            emitMediaStatus()
        }
    }

    private fun currentRemoteMediaClient(): RemoteMediaClient? {
        val client = castContext?.sessionManager?.currentCastSession?.remoteMediaClient
        attachRemoteMediaClient(client)
        return client
    }

    private fun attachRemoteMediaClient(client: RemoteMediaClient?) {
        if (remoteMediaClient === client) return
        detachRemoteMediaClient()
        remoteMediaClient = client
        client?.registerCallback(remoteMediaClientCallback)
        if (client != null) startStatusUpdates()
    }

    private fun detachRemoteMediaClient() {
        remoteMediaClient?.unregisterCallback(remoteMediaClientCallback)
        remoteMediaClient = null
        stopStatusUpdates()
    }

    private fun startStatusUpdates() {
        if (statusUpdatesRunning) return
        statusUpdatesRunning = true
        handler.removeCallbacks(statusUpdateRunnable)
        handler.post(statusUpdateRunnable)
    }

    private fun stopStatusUpdates() {
        statusUpdatesRunning = false
        handler.removeCallbacks(statusUpdateRunnable)
    }

    private fun buildMediaInfo(item: CastMediaItem): MediaInfo =
        MediaInfo.Builder(item.url)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(item.contentType.ifBlank { "audio/mpeg" })
            .setStreamDuration(item.durationMs)
            .setMetadata(buildMetadata(item))
            .setCustomData(buildCustomData(item))
            .build()

    private fun buildCustomData(item: CastMediaItem): JSONObject = JSONObject().apply {
        put("songId", item.songId)
        put("applicationName", "Ferrotune")
        put("position", item.position)
    }

    private fun buildMetadata(item: CastMediaItem): MediaMetadata {
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK)
        metadata.putString(MediaMetadata.KEY_TITLE, item.title)
        metadata.putString(MediaMetadata.KEY_ARTIST, item.artist)
        item.album?.takeIf { it.isNotBlank() }?.let {
            metadata.putString(MediaMetadata.KEY_ALBUM_TITLE, it)
        }
        item.coverArtUrl?.takeIf { it.isNotBlank() }?.let {
            metadata.addImage(WebImage(Uri.parse(it)))
        }
        return metadata
    }

    private fun castRepeatMode(repeatMode: String): Int = when (repeatMode) {
        "all" -> MediaStatus.REPEAT_MODE_REPEAT_ALL
        "one" -> MediaStatus.REPEAT_MODE_REPEAT_SINGLE
        else -> MediaStatus.REPEAT_MODE_REPEAT_OFF
    }

    private fun emitStateChanged() {
        val context = castContext
        val session = context?.sessionManager?.currentCastSession
        _state.value = CastConnectionState(
            available = context != null,
            connectionState = castStateName(context?.castState),
            deviceName = session?.castDevice?.friendlyName,
        )
    }

    private fun emitMediaStatus() {
        val session = castContext?.sessionManager?.currentCastSession
        val client = session?.remoteMediaClient
        val status = client?.mediaStatus
        val currentQueueItem = status?.getQueueItemById(status.currentItemId)
        val mediaInfo = currentQueueItem?.media ?: status?.mediaInfo
        val metadata = mediaInfo?.metadata
        val customData = currentQueueItem?.customData ?: mediaInfo?.customData
        val songId = customData?.optString("songId")?.takeIf { it.isNotBlank() }
        val queuePosition = customData
            ?.takeIf { it.has("position") && !it.isNull("position") }
            ?.optInt("position")

        _status.value = CastMediaStatus(
            isPlaying = isPlaying(status),
            positionMs = client?.approximateStreamPosition ?: 0L,
            durationMs = client?.streamDuration ?: 0L,
            songId = songId,
            queuePosition = queuePosition,
            title = metadata?.getString(MediaMetadata.KEY_TITLE),
            artist = metadata?.getString(MediaMetadata.KEY_ARTIST),
            volume = session?.volume ?: 1.0,
            isMuted = session?.isMute ?: false,
        )
    }

    private fun castStateName(state: Int?): String = when (state) {
        CastState.NO_DEVICES_AVAILABLE, CastState.NOT_CONNECTED ->
            CastConnectionState.STATE_AVAILABLE
        CastState.CONNECTING -> CastConnectionState.STATE_CONNECTING
        CastState.CONNECTED -> CastConnectionState.STATE_CONNECTED
        else -> CastConnectionState.STATE_UNAVAILABLE
    }

    private fun isPlaying(status: MediaStatus?): Boolean =
        status?.playerState == MediaStatus.PLAYER_STATE_PLAYING ||
            status?.playerState == MediaStatus.PLAYER_STATE_BUFFERING

    companion object {
        private const val TAG = "CastManager"
        private const val STATUS_UPDATE_INTERVAL_MS = 1_000L
    }
}
