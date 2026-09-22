package com.ferrotune.core.media

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import com.ferrotune.core.media.cast.CastMediaItem
import com.ferrotune.core.network.PlaybackSessionResetter
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Application-scoped front end for [PlaybackService]. Binds on first use,
 * mirrors the service state into flows, and exposes commands as suspend
 * functions so callers never touch the raw binder.
 */
@Singleton
class PlaybackRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) : PlaybackSettingsApplier, PlaybackSessionResetter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val bindRequested = AtomicBoolean(false)
    private val serviceReady = CompletableDeferred<PlaybackService>()

    private val _state = MutableStateFlow(PlaybackState())
    val state: StateFlow<PlaybackState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<PlaybackEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<PlaybackEvent> = _events.asSharedFlow()

    @Volatile
    private var currentSettings: PlaybackSettings = PlaybackSettings()

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? PlaybackService.LocalBinder)?.getService() ?: return
            if (!serviceReady.isCompleted) {
                serviceReady.complete(service)
            }
            service.updateSettings(currentSettings)
            _state.value = service.getState()
            scope.launch {
                service.events.collect { event ->
                    applyEvent(event)
                    _events.emit(event)
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            // The service runs in our own process; Android rebinds after a
            // restart and onServiceConnected refreshes the mirrored state.
        }
    }

    fun ensureBound() {
        if (bindRequested.compareAndSet(false, true)) {
            val intent = Intent(context, PlaybackService::class.java)
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }
    }

    suspend fun awaitService(): PlaybackService {
        ensureBound()
        return serviceReady.await()
    }

    suspend fun initSession(config: SessionConfig, settings: PlaybackSettings) {
        currentSettings = settings
        val service = awaitService()
        service.initSession(config)
        service.updateSettings(settings)
    }

    suspend fun startPlayback(
        totalCount: Int,
        currentIndex: Int,
        isShuffled: Boolean,
        repeatMode: String,
        startPositionMs: Long = 0,
        sessionId: String? = null,
        sourceType: String? = null,
        sourceId: String? = null,
    ) {
        awaitService().startPlayback(
            totalCount = totalCount,
            currentIndex = currentIndex,
            isShuffled = isShuffled,
            repeatMode = repeatMode,
            playWhenReady = true,
            startPositionMs = startPositionMs,
            sessionId = sessionId,
            sourceType = sourceType,
            sourceId = sourceId,
        )
    }

    suspend fun play() = awaitService().play()

    suspend fun pause() = awaitService().pause()

    suspend fun stop() = awaitService().stop()

    /** Stops playback and drops the server session (used on account switch). */
    override suspend fun resetSession() {
        val service = awaitService()
        service.stop()
        service.resetSession()
    }

    suspend fun nextTrack() = awaitService().nextTrack()

    suspend fun previousTrack(force: Boolean = false) = awaitService().previousTrack(force)

    suspend fun seek(positionMs: Long) = awaitService().seek(positionMs)

    suspend fun playAtIndex(index: Int) = awaitService().playAtIndex(index)

    suspend fun startOfflinePlayback(
        response: GetQueueResponse,
        playWhenReady: Boolean = true,
    ) = awaitService().startOfflinePlayback(response, playWhenReady)

    suspend fun setRepeatMode(mode: String) = awaitService().setRepeatMode(mode)

    suspend fun setShuffle(enabled: Boolean) = awaitService().autonomousToggleShuffle(enabled).await()

    suspend fun setVolume(volume: Float) = awaitService().setVolume(volume)

    suspend fun updateStarredState(starred: Boolean) = awaitService().updateStarredState(starred)

    override suspend fun applySettings(settings: PlaybackSettings) {
        currentSettings = settings
        if (serviceReady.isCompleted) {
            awaitService().updateSettings(settings)
        }
    }

    suspend fun castMediaItems(): List<CastMediaItem> = awaitService().castMediaItems()

    suspend fun refreshState(): PlaybackState = awaitService().getState().also { _state.value = it }

    private fun applyEvent(event: PlaybackEvent) {
        when (event) {
            is PlaybackEvent.StateChanged -> _state.value = event.state
            is PlaybackEvent.Progress -> _state.update {
                it.copy(positionMs = event.positionMs, durationMs = event.durationMs)
            }
            is PlaybackEvent.TrackChanged -> _state.update {
                it.copy(track = event.track, queueIndex = event.queueIndex)
            }
            is PlaybackEvent.QueueStateChanged -> _state.update {
                it.copy(
                    queueLength = event.totalCount,
                    queueIndex = event.currentIndex,
                )
            }
            is PlaybackEvent.PlaybackError,
            is PlaybackEvent.RepeatModeChanged,
            is PlaybackEvent.Scrobbled,
            is PlaybackEvent.StarToggled,
            is PlaybackEvent.Clipping,
            -> Unit
        }
    }
}
