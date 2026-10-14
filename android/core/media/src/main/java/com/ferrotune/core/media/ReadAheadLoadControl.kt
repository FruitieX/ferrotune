package com.ferrotune.core.media

import androidx.media3.common.C
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator

/**
 * Holds the long read-ahead buffer back until the listener settles on a
 * track. After a skip or a new queue only the playing track and the next one
 * load, so skipping through a queue doesn't download songs that are never
 * heard (each one is several megabytes). Once a track has played for
 * [SETTLE_PLAYBACK_MS] the delegate's full buffer applies again, which lets
 * the radio idle for minutes between loads.
 *
 * [settled] and [playingWindowIndex] are written on the main thread and read
 * on the playback thread.
 *
 * Kotlin's `by` delegation skips Java default methods, so every method
 * ExoPlayer calls is forwarded explicitly (the interface's defaults throw).
 */
@UnstableApi
class ReadAheadLoadControl(private val delegate: LoadControl) : LoadControl {
    @Volatile
    var settled: Boolean = false
        private set

    @Volatile
    private var playingWindowIndex: Int = 0

    /** A skip or a new queue: load just this track and the next for now. */
    fun unsettle(playingIndex: Int) {
        playingWindowIndex = playingIndex
        settled = false
    }

    /** Called about once a second while playing. */
    fun onPlaybackProgress(playingIndex: Int, positionMs: Long) {
        playingWindowIndex = playingIndex
        if (!settled && positionMs >= SETTLE_PLAYBACK_MS) settled = true
    }

    override fun onPrepared(playerId: PlayerId) = delegate.onPrepared(playerId)

    override fun onTracksSelected(
        parameters: LoadControl.Parameters,
        trackGroups: TrackGroupArray,
        trackSelections: Array<out ExoTrackSelection?>,
    ) = delegate.onTracksSelected(parameters, trackGroups, trackSelections)

    override fun onStopped(playerId: PlayerId) = delegate.onStopped(playerId)

    override fun onReleased(playerId: PlayerId) = delegate.onReleased(playerId)

    override fun getAllocator(playerId: PlayerId): Allocator = delegate.getAllocator(playerId)

    override fun getBackBufferDurationUs(playerId: PlayerId): Long = delegate.getBackBufferDurationUs(playerId)

    override fun retainBackBufferFromKeyframe(playerId: PlayerId): Boolean =
        delegate.retainBackBufferFromKeyframe(playerId)

    override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean =
        delegate.shouldStartPlayback(parameters)

    override fun shouldContinuePreloading(
        playerId: PlayerId,
        timeline: Timeline,
        mediaPeriodId: MediaSource.MediaPeriodId,
        bufferedDurationUs: Long,
    ): Boolean = delegate.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)

    override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
        if (!settled) {
            val periodIndex = parameters.timeline.getIndexOfPeriod(parameters.mediaPeriodId.periodUid)
            if (periodIndex != C.INDEX_UNSET) {
                val loadingIndex = parameters.timeline.getPeriod(periodIndex, scratchPeriod).windowIndex
                if (isBeyondNextTrack(loadingIndex, playingWindowIndex)) return false
            }
        }
        return delegate.shouldContinueLoading(parameters)
    }

    // Only touched on the playback thread.
    private val scratchPeriod = Timeline.Period()

    companion object {
        const val SETTLE_PLAYBACK_MS = 30_000L

        /** Whether loading [loadingIndex] would read past the track after [playingIndex]. */
        internal fun isBeyondNextTrack(loadingIndex: Int, playingIndex: Int): Boolean =
            loadingIndex > playingIndex + 1
    }
}
