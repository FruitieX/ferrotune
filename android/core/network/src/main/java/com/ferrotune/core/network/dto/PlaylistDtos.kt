package com.ferrotune.core.network.dto

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class CreateFolderRequest(
    val name: String,
    val parentId: String? = null,
)

@Serializable
data class UpdateFolderRequest(
    val name: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val parentId: JsonElement? = null,
)

@Serializable
data class MovePlaylistRequest(
    val folderId: String? = null,
)

@Serializable
data class ReorderPlaylistRequest(
    val songIds: List<String>,
)

@Serializable
data class GetPlaylistSongsParams(
    val offset: Int? = null,
    val count: Int? = null,
    val sort: String? = null,
    val sortDir: String? = null,
    val filter: String? = null,
    val entryType: String? = null,
    val inlineImages: String? = null,
)

@Serializable
data class SmartPlaylistSongsParams(
    val offset: Long? = null,
    val count: Long? = null,
    val inlineImages: String? = null,
    val filter: String? = null,
    val sortField: String? = null,
    val sortDirection: String? = null,
)
