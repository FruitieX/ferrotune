package com.ferrotune.audio

internal object PlaybackNotificationIntent {
    const val EXTRA_OPEN_NOW_PLAYING = "com.ferrotune.audio.OPEN_NOW_PLAYING"

    fun shouldOpenNowPlaying(marker: Boolean?): Boolean {
        return marker == true
    }
}
