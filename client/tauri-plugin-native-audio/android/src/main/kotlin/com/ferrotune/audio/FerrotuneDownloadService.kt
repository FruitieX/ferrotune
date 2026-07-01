package com.ferrotune.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheKeyFactory
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import app.tauri.plugin.JSObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

@OptIn(UnstableApi::class)
class FerrotuneDownloadService : DownloadService(
    /* foregroundNotificationId = */ NOTIFICATION_ID,
    /* foregroundNotificationUpdateInterval = */ 1000L,
    /* channelId = */ CHANNEL_ID,
    /* channelNameResourceId = */ R.string.ferrotune_download_channel_name,
    /* channelDescriptionResourceId = */ R.string.ferrotune_download_channel_description,
) {
    override fun onCreate() {
        DownloadManagerHolder.initialize(applicationContext)
        super.onCreate()
    }

    @OptIn(UnstableApi::class)
    override fun getDownloadManager(): DownloadManager {
        DownloadManagerHolder.initialize(applicationContext)
        return DownloadManagerHolder.manager
            ?: error("DownloadManager failed to initialize")
    }

    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(
        downloads: MutableList<Download>,
        notMetRequirements: Int,
    ): Notification {
        ensureChannel()
        val activeCount = downloads.count {
            it.state == Download.STATE_DOWNLOADING || it.state == Download.STATE_QUEUED
        }
        val percent: Float = downloads
            .filter { it.state == Download.STATE_DOWNLOADING && it.contentLength > 0 }
            .map { (it.bytesDownloaded.toFloat() / it.contentLength) * 100f }
            .let { if (it.isEmpty()) -1f else it.average().toFloat() }
        val title = if (activeCount == 0) {
            "Ferrotune downloads"
        } else {
            "Downloading $activeCount track${if (activeCount > 1) "s" else ""}"
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (percent >= 0f) {
            builder.setProgress(100, percent.toInt(), false)
        } else if (activeCount > 0) {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.ferrotune_download_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.ferrotune_download_channel_description)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val NOTIFICATION_ID = 2001
        const val CHANNEL_ID = "ferrotune-downloads"
    }
}

/**
 * Stable cache-key factory that maps stream URIs to canonical per-song keys
 * (e.g. `audio:<songId>`) so that downloaded bytes — written under the same
 * canonical key via `DownloadRequest.customCacheKey` — can be served back
 * during playback regardless of which transcoding bitrate the player
 * currently requests.
 *
 * Transcoded `timeOffset` seeks are excluded from the canonical key (they
 * represent different encoded bytes for the same source audio, so the cached
 * from-start bytes can't satisfy them).
 */
@OptIn(UnstableApi::class)
class FerrotuneCacheKeyFactory : CacheKeyFactory {
    override fun buildCacheKey(dataSpec: DataSpec): String {
        // Honor explicit DataSpec.key (set by DownloadRequest.customCacheKey
        // during downloads, or by MediaItem.customCacheKey elsewhere).
        dataSpec.key?.let { return it }

        val uri = dataSpec.uri
        val path = uri.path ?: return uri.toString()
        return when {
            path.endsWith("/api/stream") -> {
                // Don't collapse transcoded seek URLs into the canonical
                // audio key — they represent audio data encoded at a
                // different time offset (different byte layout).
                if (uri.getQueryParameter("timeOffset") != null) {
                    return uri.toString()
                }
                val songId = uri.getQueryParameter("id")
                if (songId != null) "audio:$songId" else uri.toString()
            }
            path.endsWith("/api/cover-art") -> {
                val coverArtId = uri.getQueryParameter("id")
                if (coverArtId != null) "cover:$coverArtId" else uri.toString()
            }
            else -> uri.toString()
        }
    }
}

/**
 * Singleton holding the [DownloadManager] and download [SimpleCache], decoupled
 * from the [FerrotuneDownloadService] lifecycle so JS commands can query state
 * synchronously without binding the service.
 *
 * Downloads are content-addressable by song ID across all Ferrotune accounts
 * on this device — the same song downloaded by two different accounts shares
 * one set of bytes on disk and is reused.
 */
@OptIn(UnstableApi::class)
object DownloadManagerHolder {
    private const val TAG = "DownloadManagerHolder"
    private const val DOWNLOAD_CACHE_DIR_NAME = "exo-download-cache"

    @Volatile private var managerRef: DownloadManager? = null
    @Volatile private var downloadCacheRef: SimpleCache? = null
    @Volatile private var httpFactoryRef: DefaultHttpDataSource.Factory? = null
    @Volatile private var eventEmitter: ((String, JSObject) -> Unit)? = null
    @Volatile private var streamCacheRef: SimpleCache? = null

    private val apiClient = FerrotuneApiClient()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val lastEmitMs = ConcurrentHashMap<String, Long>()
    private var wifiOnly: Boolean = true

    @Synchronized
    fun initialize(context: Context) {
        if (managerRef != null) return
        val appContext = context.applicationContext
        val cacheDir = File(appContext.cacheDir, DOWNLOAD_CACHE_DIR_NAME)
        val databaseProvider = StandaloneDatabaseProvider(appContext)
        val cache = SimpleCache(
            cacheDir,
            NoOpCacheEvictor(),
            databaseProvider,
        )
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("ferrotune-download")
            .setAllowCrossProtocolRedirects(true)
        downloadCacheRef = cache
        httpFactoryRef = httpFactory

        val mgr = DownloadManager(
            appContext,
            databaseProvider,
            cache,
            httpFactory,
            Runnable::run,
        )
        // Install our cache-key factory so download bytes are written under
        // the same canonical keys the playback CacheDataSource will look up.
        mgr.setRequirements(buildRequirements())
        // New managers start in the paused state — clear it so downloads
        // actually progress when enqueued.
        mgr.resumeDownloads()
        mgr.addListener(DownloadStateBroadcaster)
        managerRef = mgr
        Log.i(TAG, "DownloadManager initialized; cacheDir=$cacheDir")
    }

    val manager: DownloadManager?
        get() = managerRef

    val downloadCache: SimpleCache?
        get() = downloadCacheRef

    val httpDataSourceFactory: DefaultHttpDataSource.Factory?
        get() = httpFactoryRef

    fun cacheKeyFactory(): CacheKeyFactory = FerrotuneCacheKeyFactory()

    fun setEventEmitter(emitter: ((String, JSObject) -> Unit)?) {
        eventEmitter = emitter
    }

    fun setStreamCache(streamCache: SimpleCache?) {
        streamCacheRef = streamCache
    }

    fun setSessionConfig(config: SessionConfig) {
        val factory = httpFactoryRef ?: return
        if (config.sessionToken != null) {
            factory.setDefaultRequestProperties(
                mapOf("Authorization" to "Bearer ${config.sessionToken}")
            )
        }
        apiClient.setSessionConfig(config)
    }

    fun setWifiOnly(wifiOnly: Boolean) {
        this.wifiOnly = wifiOnly
        managerRef?.setRequirements(buildRequirements())
    }

    private fun buildRequirements(): Requirements {
        return if (wifiOnly) {
            Requirements(Requirements.NETWORK_UNMETERED)
        } else {
            Requirements(Requirements.NETWORK)
        }
    }

    fun enqueueDownload(
        context: Context,
        songId: String,
        format: String,
        maxBitRate: Int?,
    ) {
        val contentId = "audio:$songId"
        // apiClient throws if no session is configured; surface the message.
        val streamUrl = apiClient.buildDownloadStreamUrl(songId, format, maxBitRate)
        val request = DownloadRequest.Builder(contentId, Uri.parse(streamUrl))
            .setCustomCacheKey(contentId)
            .setMimeType("audio/ogg")
            .build()
        DownloadService.sendAddDownload(
            context,
            FerrotuneDownloadService::class.java,
            request,
            /* stopReason = */ Download.STOP_REASON_NONE,
            /* foreground = */ true,
        )
    }

    fun cancelDownload(context: Context, songId: String) {
        val contentId = "audio:$songId"
        DownloadService.sendRemoveDownload(
            context,
            FerrotuneDownloadService::class.java,
            contentId,
            /* foreground = */ true,
        )
        evictAllCachesForContent(contentId)
    }

    fun pauseAll(context: Context) {
        DownloadService.sendPauseDownloads(
            context,
            FerrotuneDownloadService::class.java,
            /* foreground = */ true,
        )
    }

    fun resumeAll(context: Context) {
        DownloadService.sendResumeDownloads(
            context,
            FerrotuneDownloadService::class.java,
            /* foreground = */ true,
        )
    }

    fun removeAll(context: Context) {
        DownloadService.sendRemoveAllDownloads(
            context,
            FerrotuneDownloadService::class.java,
            /* foreground = */ true,
        )
        downloadCacheRef?.let { cache ->
            try { cache.keys.forEach { evictAllCachesForContent(it) } } catch (e: Exception) {
                Log.w(TAG, "Failed to clear download cache", e)
            }
        }
    }

    private fun evictAllCachesForContent(contentId: String) {
        // The contentId IS the cache key (set via customCacheKey) for both
        // the streaming cache and the download cache; evict from both so
        // downloaded bytes don't shadow future re-streams.
        try { streamCacheRef?.removeResource(contentId) } catch (e: Exception) {
            Log.w(TAG, "Failed to evict stream cache for $contentId", e)
        }
        try { downloadCacheRef?.removeResource(contentId) } catch (e: Exception) {
            Log.w(TAG, "Failed to evict download cache for $contentId", e)
        }
    }

    fun snapshot(): List<DownloadInfo> {
        val mgr = managerRef ?: return emptyList()
        return mgr.currentDownloads.map { it.toDownloadInfo() }
    }

    fun snapshot(contentId: String): DownloadInfo? {
        val mgr = managerRef ?: return null
        return mgr.currentDownloads.firstOrNull { it.request.id == contentId }?.toDownloadInfo()
    }

    private object DownloadStateBroadcaster : DownloadManager.Listener {
        override fun onDownloadChanged(
            mgr: DownloadManager,
            download: Download,
            finalException: java.lang.Exception?,
        ) {
            broadcast(listOf(download))
            if (download.state == Download.STATE_COMPLETED) {
                evictStreamCacheForDownload(download)
            }
        }

        override fun onDownloadRemoved(mgr: DownloadManager, download: Download) {
            broadcast(listOf(download))
            evictStreamCacheForDownload(download)
        }

        override fun onDownloadsPausedChanged(mgr: DownloadManager, paused: Boolean) {
            broadcast(mgr.currentDownloads.toList(), forcePaused = paused)
        }

        override fun onRequirementsStateChanged(
            mgr: DownloadManager,
            requirements: Requirements,
            notMetRequirements: Int,
        ) {
            broadcast(emptyList(), forceNotMetRequirements = notMetRequirements)
        }
    }

    private fun broadcast(
        downloads: List<Download>,
        forcePaused: Boolean? = null,
        forceNotMetRequirements: Int? = null,
    ) {
        val emitter = eventEmitter ?: return
        val mgr = managerRef ?: return
        val now = System.currentTimeMillis()
        val paused = forcePaused ?: mgr.downloadsPaused
        val notMet = forceNotMetRequirements ?: 0

        // Throttle per-contentId to one event every 250ms except terminal states.
        val emitNow = downloads.filter { d ->
            d.state == Download.STATE_COMPLETED ||
                d.state == Download.STATE_FAILED ||
                d.state == Download.STATE_REMOVING ||
                (now - (lastEmitMs[d.request.id] ?: 0L) >= 250L).also {
                    if (it) lastEmitMs[d.request.id] = now
                }
        }
        if (emitNow.isEmpty()) return

        val info: List<DownloadInfo> = emitNow.map { it.toDownloadInfo() }
        val payload = DownloadStateEventPayload(
            downloads = info,
            paused = paused,
            notMetRequirements = notMet,
        )
        val jsObj = payload.toJSObject()
        mainHandler.post { emitter(AudioEvents.DOWNLOAD_STATE_CHANGED, jsObj) }
    }

    private fun evictStreamCacheForDownload(download: Download) {
        val sc = streamCacheRef ?: return
        // customCacheKey is the cache key under which the downloaded bytes
        // (and any LRU streaming bytes for the same song) live.
        val key = download.request.customCacheKey ?: download.request.uri.toString()
        try {
            val removed = sc.getCacheSpace().let { before ->
                sc.removeResource(key)
                before - sc.getCacheSpace()
            }
            if (removed > 0) {
                Log.d(TAG, "Evicted $removed stream-cache bytes for $key")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to evict stream cache for $key", e)
        }
    }
}

private fun Download.toDownloadInfo(): DownloadInfo {
    val songId: String = request.id.removePrefix("audio:").removePrefix("cover:")
    val kind = if (request.id.startsWith("audio:")) "audio" else if (request.id.startsWith("cover:")) "cover" else "unknown"
    val isTerminalFailure = state == Download.STATE_FAILED
    val isManualPause = state == Download.STATE_STOPPED && stopReason != Download.STOP_REASON_NONE
    val status = DownloadStatus.fromMedia3State(state, isTerminalFailure, isManualPause)
    val percent: Float = if (contentLength > 0) {
        (bytesDownloaded.toFloat() / contentLength) * 100f
    } else {
        if (state == Download.STATE_COMPLETED) 100f else 0f
    }
    val failureReason: String? = when (failureReason) {
        Download.FAILURE_REASON_NONE -> null
        Download.FAILURE_REASON_UNKNOWN -> "unknown"
        else -> "unknown"
    }
    return DownloadInfo(
        contentId = request.id,
        songId = songId,
        kind = kind,
        status = status.jsValue,
        percent = percent,
        bytesDownloaded = bytesDownloaded,
        bytesTotal = contentLength.takeIf { it > 0 } ?: 0L,
        failureReason = failureReason,
    )
}
