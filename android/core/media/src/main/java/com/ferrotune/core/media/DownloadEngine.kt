package com.ferrotune.core.media

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.SharedFlow

/**
 * Thin surface over [DownloadManagerHolder] so download UI state can be
 * driven and tested without the Media3 singleton.
 */
interface DownloadEngine {
    val events: SharedFlow<DownloadStateEventPayload>

    fun initialize()

    fun snapshot(): List<DownloadInfo>

    fun enqueue(songId: String, format: String, maxBitRate: Int?)

    fun cancel(songId: String)

    fun pauseAll()

    fun resumeAll()

    fun removeAll()

    fun setWifiOnly(wifiOnly: Boolean)
}

@Singleton
class Media3DownloadEngine @Inject constructor(
    @ApplicationContext private val context: Context,
) : DownloadEngine {
    override val events: SharedFlow<DownloadStateEventPayload>
        get() = DownloadManagerHolder.events

    override fun initialize() {
        DownloadManagerHolder.initialize(context)
    }

    override fun snapshot(): List<DownloadInfo> = DownloadManagerHolder.snapshot()

    override fun enqueue(songId: String, format: String, maxBitRate: Int?) {
        DownloadManagerHolder.enqueueDownload(context, songId, format, maxBitRate)
    }

    override fun cancel(songId: String) {
        DownloadManagerHolder.cancelDownload(context, songId)
    }

    override fun pauseAll() {
        DownloadManagerHolder.pauseAll(context)
    }

    override fun resumeAll() {
        DownloadManagerHolder.resumeAll(context)
    }

    override fun removeAll() {
        DownloadManagerHolder.removeAll(context)
    }

    override fun setWifiOnly(wifiOnly: Boolean) {
        DownloadManagerHolder.setWifiOnly(wifiOnly)
    }
}

@Module
@InstallIn(SingletonComponent::class)
object DownloadEngineModule {
    @Provides
    @Singleton
    fun provideDownloadEngine(engine: Media3DownloadEngine): DownloadEngine = engine
}
