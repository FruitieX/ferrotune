package com.ferrotune.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class SongDto(
    val id: String,
    val title: String,
    val artist: String = "",
    val album: String? = null,
    val albumId: String? = null,
    val artistId: String? = null,
    val duration: Long = 0,
    val coverArt: String? = null,
)

@Serializable
data class RandomSongsResponseDto(
    val song: List<SongDto> = emptyList(),
)
