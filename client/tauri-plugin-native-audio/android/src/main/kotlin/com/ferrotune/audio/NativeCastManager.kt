package com.ferrotune.audio

import android.app.Activity
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.mediarouter.app.MediaRouteButton
import app.tauri.plugin.JSObject
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.CastState
import com.google.android.gms.cast.framework.CastStateListener
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import org.json.JSONObject

internal object CastEvents {
    const val STATE_CHANGED = "cast-state-changed"
    const val MEDIA_STATUS = "cast-media-status"
}

internal class NativeCastManager(
    private val activity: Activity,
    private val eventEmitter: (String, JSObject) -> Unit,
) {
    companion object {
        private const val TAG = "NativeCastManager"
        private const val STATUS_UPDATE_INTERVAL_MS = 1_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var castContext: CastContext? = null
    private var routeButton: MediaRouteButton? = null
    private var remoteMediaClient: RemoteMediaClient? = null
    private var statusUpdatesRunning = false

    private data class CastMediaItemData(
        val url: String,
        val contentType: String,
        val songId: String,
        val title: String,
        val artist: String,
        val album: String?,
        val coverArtUrl: String?,
        val durationMs: Long,
        val position: Int?,
    )

    private val statusUpdateRunnable = object : Runnable {
        override fun run() {
            if (!statusUpdatesRunning) return
            emitMediaStatus()
            handler.postDelayed(this, STATUS_UPDATE_INTERVAL_MS)
        }
    }

    private val castStateListener = CastStateListener { emitStateChanged() }

    private val remoteMediaClientCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            emitMediaStatus()
        }

        override fun onMetadataUpdated() {
            emitMediaStatus()
        }

        override fun onQueueStatusUpdated() {
            emitMediaStatus()
        }
    }

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) {
            emitStateChanged("connecting")
        }

        override fun onSessionStarted(session: CastSession, sessionId: String) {
            activity.volumeControlStream = AudioManager.STREAM_MUSIC
            attachRemoteMediaClient(session.remoteMediaClient)
            emitStateChanged()
            emitMediaStatus()
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            Log.w(TAG, "Cast session start failed: $error")
            emitStateChanged()
        }

        override fun onSessionEnding(session: CastSession) {
            emitStateChanged("connecting")
        }

        override fun onSessionEnded(session: CastSession, error: Int) {
            detachRemoteMediaClient()
            emitStateChanged()
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) {
            emitStateChanged("connecting")
        }

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            activity.volumeControlStream = AudioManager.STREAM_MUSIC
            attachRemoteMediaClient(session.remoteMediaClient)
            emitStateChanged()
            emitMediaStatus()
        }

        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            Log.w(TAG, "Cast session resume failed: $error")
            detachRemoteMediaClient()
            emitStateChanged()
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) {
            Log.w(TAG, "Cast session suspended: $reason")
            emitStateChanged()
        }
    }

    fun initialize() {
        handler.post {
            try {
                val context = CastContext.getSharedInstance(activity.applicationContext)
                activity.volumeControlStream = AudioManager.STREAM_MUSIC
                castContext = context
                context.addCastStateListener(castStateListener)
                context.sessionManager.addSessionManagerListener(sessionListener, CastSession::class.java)
                attachRemoteMediaClient(context.sessionManager.currentCastSession?.remoteMediaClient)
                setupRouteButton()
                emitStateChanged()
            } catch (e: Exception) {
                Log.w(TAG, "Cast framework unavailable", e)
                NativeAudioLogger.warn(TAG, "cast_unavailable", "Native Cast framework unavailable", throwable = e)
                emitStateChanged("unavailable")
            }
        }
    }

    fun release() {
        handler.post {
            castContext?.removeCastStateListener(castStateListener)
            castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
            stopStatusUpdates()
            detachRemoteMediaClient()
            routeButton?.let { button ->
                (button.parent as? ViewGroup)?.removeView(button)
            }
            routeButton = null
            castContext = null
        }
    }

    fun getState(): JSObject {
        return stateObject()
    }

    fun refreshState() {
        handler.post {
            emitStateChanged()
            emitMediaStatus()
        }
    }

    fun requestSession() {
        handler.post {
            try {
                setupRouteButton()
                val clicked = routeButton?.performClick() ?: false
                if (!clicked) {
                    Log.w(TAG, "Cast route button did not open chooser")
                    NativeAudioLogger.warn(TAG, "cast_request_failed", "Cast route chooser could not be opened")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Cast route chooser could not be opened", e)
                NativeAudioLogger.warn(TAG, "cast_request_failed", "Cast route chooser could not be opened", throwable = e)
                emitStateChanged("unavailable")
            }
        }
    }

    fun stopSession() {
        handler.post {
            castContext?.sessionManager?.endCurrentSession(true)
        }
    }

    fun loadMedia(args: LoadCastMediaArgs, onSuccess: () -> Unit, onError: (String) -> Unit) {
        handler.post {
            val client = currentRemoteMediaClient()
            if (client == null) {
                onError("No Cast session is connected")
                return@post
            }

            val queueItems = args.queueItems
                ?.map { it.toCastMediaItemData() }
                ?.takeIf { it.isNotEmpty() }

            if (queueItems != null) {
                val castQueueItems = queueItems.map { item ->
                    MediaQueueItem.Builder(buildMediaInfo(item))
                        .setAutoplay(true)
                        .build()
                }.toTypedArray()
                val startIndex = queueItems
                    .indexOfFirst { it.position == args.currentIndex }
                    .takeIf { it >= 0 }
                    ?: queueItems.indexOfFirst { it.songId == args.songId }.takeIf { it >= 0 }
                    ?: 0

                client.queueLoad(
                    castQueueItems,
                    startIndex,
                    castRepeatMode(args.repeatMode),
                    args.startTimeMs,
                    null,
                ).setResultCallback { result ->
                    if (result.status.isSuccess) {
                        emitMediaStatus()
                        onSuccess()
                    } else {
                        onError(result.status.statusMessage ?: "Failed to load Cast queue")
                    }
                }
                return@post
            }

            val mediaInfo = buildMediaInfo(args.toCastMediaItemData())

            val request = MediaLoadRequestData.Builder()
                .setMediaInfo(mediaInfo)
                .setAutoplay(true)
                .setCurrentTime(args.startTimeMs)
                .build()

            client.load(request).setResultCallback { result ->
                if (result.status.isSuccess) {
                    emitMediaStatus()
                    onSuccess()
                } else {
                    onError(result.status.statusMessage ?: "Failed to load Cast media")
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

    fun stopMedia() {
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
            try {
                session.volume = volume.coerceIn(0f, 1f).toDouble()
                session.isMute = muted
                emitMediaStatus()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to set Cast volume", e)
                NativeAudioLogger.warn(TAG, "cast_volume_failed", "Failed to set Cast volume", throwable = e)
            }
        }
    }

    fun getMediaStatus(): JSObject {
        return mediaStatusObject()
    }

    private fun setupRouteButton() {
        if (routeButton != null) return
        val button = MediaRouteButton(activity)
        button.alpha = 0f
        button.layoutParams = FrameLayout.LayoutParams(1, 1)
        CastButtonFactory.setUpMediaRouteButton(activity.applicationContext, button)
        (activity.window.decorView as? ViewGroup)?.addView(button)
        routeButton = button
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
        if (client != null) {
            startStatusUpdates()
        }
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

    private fun LoadCastMediaArgs.toCastMediaItemData(): CastMediaItemData {
        return CastMediaItemData(
            url = url,
            contentType = contentType,
            songId = songId,
            title = title,
            artist = artist,
            album = album,
            coverArtUrl = coverArtUrl,
            durationMs = durationMs,
            position = currentIndex,
        )
    }

    private fun LoadCastMediaQueueItemArgs.toCastMediaItemData(): CastMediaItemData {
        return CastMediaItemData(
            url = url,
            contentType = contentType,
            songId = songId,
            title = title,
            artist = artist,
            album = album,
            coverArtUrl = coverArtUrl,
            durationMs = durationMs,
            position = position,
        )
    }

    private fun buildMediaInfo(item: CastMediaItemData): MediaInfo {
        return MediaInfo.Builder(item.url)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(item.contentType.ifBlank { "audio/mpeg" })
            .setStreamDuration(item.durationMs)
            .setMetadata(buildMetadata(item))
            .setCustomData(JSONObject().apply {
                put("songId", item.songId)
                put("applicationName", "Ferrotune")
                item.position?.let { put("position", it) }
            })
            .build()
    }

    private fun castRepeatMode(repeatMode: String): Int {
        return when (repeatMode) {
            "all" -> MediaStatus.REPEAT_MODE_REPEAT_ALL
            "one" -> MediaStatus.REPEAT_MODE_REPEAT_SINGLE
            else -> MediaStatus.REPEAT_MODE_REPEAT_OFF
        }
    }

    private fun buildMetadata(item: CastMediaItemData): MediaMetadata {
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

    private fun emitStateChanged(forcedState: String? = null) {
        eventEmitter(CastEvents.STATE_CHANGED, stateObject(forcedState))
    }

    private fun emitMediaStatus() {
        eventEmitter(CastEvents.MEDIA_STATUS, mediaStatusObject())
    }

    private fun stateObject(forcedState: String? = null): JSObject {
        val session = castContext?.sessionManager?.currentCastSession
        return JSObject().apply {
            put("state", forcedState ?: castStateName(castContext?.castState))
            put("deviceName", session?.castDevice?.friendlyName)
            put("mediaStatus", mediaStatusObject())
        }
    }

    private fun mediaStatusObject(): JSObject {
        val session = castContext?.sessionManager?.currentCastSession
        val client = session?.remoteMediaClient
        val status = client?.mediaStatus
        val mediaInfo = status?.mediaInfo
        val metadata = mediaInfo?.metadata
        val customData = mediaInfo?.customData
        val songId = customData?.optString("songId")?.takeIf { it.isNotBlank() }
        val queuePosition = if (customData?.has("position") == true && !customData.isNull("position")) {
            customData.optInt("position")
        } else {
            null
        }
        return JSObject().apply {
            put("positionMs", client?.approximateStreamPosition ?: 0L)
            put("durationMs", client?.streamDuration ?: 0L)
            put("isPlaying", isPlaying(status))
            put("playerState", playerStateName(status?.playerState))
            put("idleReason", idleReasonName(status?.idleReason))
            put("songId", songId)
            put("queuePosition", queuePosition)
            put("title", metadata?.getString(MediaMetadata.KEY_TITLE))
            put("artist", metadata?.getString(MediaMetadata.KEY_ARTIST))
            put("volume", session?.volume ?: 1.0)
            put("isMuted", session?.isMute ?: false)
        }
    }

    private fun castStateName(state: Int?): String {
        return when (state) {
            CastState.NO_DEVICES_AVAILABLE -> "available"
            CastState.NOT_CONNECTED -> "available"
            CastState.CONNECTING -> "connecting"
            CastState.CONNECTED -> "connected"
            else -> "unavailable"
        }
    }

    private fun isPlaying(status: MediaStatus?): Boolean {
        return status?.playerState == MediaStatus.PLAYER_STATE_PLAYING ||
            status?.playerState == MediaStatus.PLAYER_STATE_BUFFERING
    }

    private fun playerStateName(state: Int?): String {
        return when (state) {
            MediaStatus.PLAYER_STATE_IDLE -> "idle"
            MediaStatus.PLAYER_STATE_PLAYING -> "playing"
            MediaStatus.PLAYER_STATE_PAUSED -> "paused"
            MediaStatus.PLAYER_STATE_BUFFERING -> "buffering"
            else -> "unknown"
        }
    }

    private fun idleReasonName(reason: Int?): String? {
        return when (reason) {
            MediaStatus.IDLE_REASON_FINISHED -> "finished"
            MediaStatus.IDLE_REASON_CANCELED -> "canceled"
            MediaStatus.IDLE_REASON_INTERRUPTED -> "interrupted"
            MediaStatus.IDLE_REASON_ERROR -> "error"
            else -> null
        }
    }
}