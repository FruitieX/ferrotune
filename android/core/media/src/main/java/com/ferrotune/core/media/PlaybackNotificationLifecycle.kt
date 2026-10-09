package com.ferrotune.core.media

/**
 * Pure foreground-service policy for the native playback notification.
 *
 * Media3 requests foreground state once playback becomes user-engaged. Keep
 * it foreground during buffering and track-window transitions as long as the
 * player still intends to play and has loaded media, and while a playback
 * the user just asked for is still loading: Android only lets the service
 * enter the foreground while the app is visible, so it must not wait for
 * the network if the phone goes into a pocket right after tapping play.
 */
internal object PlaybackNotificationLifecycle {
    fun shouldKeepServiceForeground(
        startInForegroundRequired: Boolean,
        playWhenReady: Boolean,
        mediaItemCount: Int,
        holdForPendingPlayback: Boolean = false,
    ): Boolean = startInForegroundRequired ||
        (mediaItemCount > 0 && (playWhenReady || holdForPendingPlayback))
}
