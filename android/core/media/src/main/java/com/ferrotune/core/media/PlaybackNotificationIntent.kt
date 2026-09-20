package com.ferrotune.core.media

object PlaybackNotificationIntent {
    const val EXTRA_OPEN_NOW_PLAYING = "com.ferrotune.core.media.OPEN_NOW_PLAYING"

    fun shouldOpenNowPlaying(marker: Boolean?): Boolean {
        return marker == true
    }
}
