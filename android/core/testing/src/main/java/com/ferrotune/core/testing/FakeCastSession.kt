package com.ferrotune.core.testing

import com.ferrotune.core.media.cast.CastConnectionState
import com.ferrotune.core.media.cast.CastMediaItem
import com.ferrotune.core.media.cast.CastMediaStatus
import com.ferrotune.core.media.cast.CastSessionPort
import kotlinx.coroutines.flow.MutableStateFlow

/** [CastSessionPort] whose connection and receiver status tests set directly. */
class FakeCastSession : CastSessionPort {
    override val state = MutableStateFlow(CastConnectionState())
    override val status = MutableStateFlow(CastMediaStatus())
    val loads = mutableListOf<Pair<List<CastMediaItem>, Int>>()

    override suspend fun loadQueue(items: List<CastMediaItem>, startIndex: Int, startTimeMs: Long, repeatMode: String): Boolean {
        loads += items to startIndex
        return true
    }

    fun connect(deviceName: String = "Living Room") {
        state.value = CastConnectionState(available = true, connectionState = CastConnectionState.STATE_CONNECTED, deviceName = deviceName)
    }

    fun disconnect() {
        state.value = CastConnectionState(available = true, connectionState = CastConnectionState.STATE_AVAILABLE)
        status.value = CastMediaStatus()
    }
}
