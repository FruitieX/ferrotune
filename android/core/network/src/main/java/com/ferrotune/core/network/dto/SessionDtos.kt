package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Hand-written because ts-rs does not export this request struct.
 */
@Serializable
data class SessionCommandRequest(
    val action: String,
    val positionMs: Long? = null,
    val currentIndex: Int? = null,
    val clientName: String? = null,
    val clientId: String? = null,
    val resumePlayback: Boolean? = null,
    /** Hands playback to another device: an idle phone is woken with a push. */
    val wakeTarget: Boolean? = null,
)

/**
 * Hand-written because ts-rs does not export this request struct. Owner
 * heartbeats (with an index or position) move the server's playback state.
 */
@Serializable
data class SessionHeartbeatRequest(
    val clientId: String,
    val clientName: String? = null,
    val isPlaying: Boolean,
    val currentIndex: Int? = null,
    val positionMs: Long? = null,
    val currentSongId: String? = null,
    val currentSongTitle: String? = null,
    val currentSongArtist: String? = null,
)

/**
 * Hand-written because ts-rs does not export this request struct.
 */
@Serializable
data class ConnectSessionRequest(
    val clientName: String = "ferrotune-mobile",
    val clientId: String? = null,
)

/**
 * Hand-written because ts-rs does not export this request struct. Registers
 * this install's FCM token so the server can wake it for a remote "play here".
 */
@Serializable
data class PushDeviceRequest(
    val clientId: String,
    val token: String,
    val clientName: String = "ferrotune-mobile",
    val deviceLabel: String? = null,
)
