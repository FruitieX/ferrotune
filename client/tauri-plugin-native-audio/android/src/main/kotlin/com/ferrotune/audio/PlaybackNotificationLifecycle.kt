package com.ferrotune.audio

/**
 * Pure foreground-service policy for the native playback notification.
 *
 * Media3 requests foreground state once playback becomes user-engaged. Keep
 * it foreground during buffering and track-window transitions as long as the
 * player still intends to play and has loaded media.
 */
internal object PlaybackNotificationLifecycle {
    fun shouldKeepServiceForeground(
        startInForegroundRequired: Boolean,
        playWhenReady: Boolean,
        mediaItemCount: Int,
    ): Boolean = startInForegroundRequired || (playWhenReady && mediaItemCount > 0)
}
