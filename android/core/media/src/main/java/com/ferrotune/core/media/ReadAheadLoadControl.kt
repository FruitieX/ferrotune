package com.ferrotune.core.media

import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.LoadControl

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
 */
@UnstableApi
class ReadAheadLoadControl(private val delegate: LoadControl) : LoadControl by delegate {
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
    private val scratchPeriod = androidx.media3.common.Timeline.Period()

    companion object {
        const val SETTLE_PLAYBACK_MS = 30_000L

        /** Whether loading [loadingIndex] would read past the track after [playingIndex]. */
        internal fun isBeyondNextTrack(loadingIndex: Int, playingIndex: Int): Boolean =
            loadingIndex > playingIndex + 1
    }
}
