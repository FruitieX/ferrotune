package com.ferrotune.feature.home.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.ui.graphics.vector.ImageVector
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.feature.home.data.HomePlaylistType
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeTileActionMode
import com.ferrotune.feature.home.data.HomeTileConfig
import com.ferrotune.feature.home.data.HomeTileKind
import com.ferrotune.feature.home.data.defaultHomeSection
import com.ferrotune.feature.home.data.mostPlayedRecentlySince
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/** Where a dashboard tile or section header navigates on tap. */
sealed interface HomeLinkTarget {
    data object Favorites : HomeLinkTarget
    data object History : HomeLinkTarget
    data class Section(val sectionId: String) : HomeLinkTarget
    data class Playlist(val id: String) : HomeLinkTarget
    data class SmartPlaylist(val id: String) : HomeLinkTarget
}

sealed interface HomeTileAction {
    data class Link(val target: HomeLinkTarget) : HomeTileAction
    data class Queue(val spec: QueueStartSpec) : HomeTileAction
    data class SwitchAccount(val accountKey: String?) : HomeTileAction
}

data class HomeTilePresentation(
    val id: String,
    val label: String,
    val subtitle: String,
    val icon: ImageVector,
    val action: HomeTileAction,
    val isIncomplete: Boolean = false,
)

private data class BaseTileDefinition(
    val label: String,
    val actionTarget: String,
    val icon: ImageVector,
    val link: (HomeSectionConfig?) -> HomeLinkTarget,
    val sectionKind: HomeSectionKind?,
)

private fun baseDefinition(kind: HomeTileKind): BaseTileDefinition? = when (kind) {
    HomeTileKind.FAVORITES -> BaseTileDefinition(
        label = "Favorites",
        actionTarget = "favorite songs",
        icon = Icons.Filled.Favorite,
        link = { HomeLinkTarget.Favorites },
        sectionKind = null,
    )

    HomeTileKind.HISTORY -> BaseTileDefinition(
        label = "Recently Played",
        actionTarget = "listening history",
        icon = Icons.Filled.History,
        link = { HomeLinkTarget.History },
        sectionKind = null,
    )

    HomeTileKind.FORGOTTEN_FAVORITES -> BaseTileDefinition(
        label = "Forgotten Favorites",
        actionTarget = "favorite songs",
        icon = Icons.Filled.History,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.FORGOTTEN_FAVORITES,
    )

    HomeTileKind.MOST_PLAYED_RECENTLY -> BaseTileDefinition(
        label = "Most Played Recently",
        actionTarget = "tracks",
        icon = Icons.Filled.TrendingUp,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.MOST_PLAYED_RECENTLY,
    )

    HomeTileKind.CONTINUE_LISTENING -> BaseTileDefinition(
        label = "Continue Listening",
        actionTarget = "sources",
        icon = Icons.Filled.PlayArrow,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.CONTINUE_LISTENING,
    )

    HomeTileKind.RECENTLY_ADDED -> BaseTileDefinition(
        label = "Recently Added",
        actionTarget = "albums",
        icon = Icons.Filled.Schedule,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.RECENTLY_ADDED,
    )

    HomeTileKind.DISCOVER -> BaseTileDefinition(
        label = "Discover",
        actionTarget = "albums",
        icon = Icons.Filled.AutoAwesome,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.DISCOVER,
    )

    HomeTileKind.SIMILAR_TRACKS -> BaseTileDefinition(
        label = "Similar To What You've Heard",
        actionTarget = "songs",
        icon = Icons.Filled.GraphicEq,
        link = { HomeLinkTarget.Section(requireNotNull(it).id) },
        sectionKind = HomeSectionKind.SIMILAR_TRACKS,
    )

    HomeTileKind.PLAYLIST, HomeTileKind.ACCOUNT_SWITCH -> null
}

/** Mirrors the web client's per-tile presentation and queue source mapping. */
fun homeTilePresentation(
    tile: HomeTileConfig,
    sections: List<HomeSectionConfig> = emptyList(),
): HomeTilePresentation {
    val action = tile.effectiveAction ?: HomeTileActionMode.OPEN

    if (tile.kind == HomeTileKind.PLAYLIST) {
        val playlistName = tile.playlistName ?: "Choose playlist"
        val typeLabel = if (tile.playlistType == HomePlaylistType.SMART_PLAYLIST) {
            "smart playlist"
        } else {
            "playlist"
        }
        val incomplete = tile.playlistId.isNullOrBlank() || tile.playlistType == null
        val icon = if (action == HomeTileActionMode.SHUFFLE) {
            Icons.Filled.Shuffle
        } else {
            Icons.AutoMirrored.Filled.QueueMusic
        }
        val tileAction = if (action == HomeTileActionMode.OPEN) {
            val target = when {
                incomplete -> null
                tile.playlistType == HomePlaylistType.SMART_PLAYLIST ->
                    HomeLinkTarget.SmartPlaylist(tile.playlistId!!)

                else -> HomeLinkTarget.Playlist(tile.playlistId!!)
            }
            target?.let { HomeTileAction.Link(it) }
                ?: HomeTileAction.Queue(
                    QueueStartSpec(
                        sourceType = tile.playlistType?.apiValue ?: "playlist",
                        sourceId = tile.playlistId,
                        sourceName = playlistName,
                        shuffle = false,
                    ),
                )
        } else {
            HomeTileAction.Queue(
                QueueStartSpec(
                    sourceType = tile.playlistType?.apiValue ?: "playlist",
                    sourceId = tile.playlistId,
                    sourceName = playlistName,
                    shuffle = action == HomeTileActionMode.SHUFFLE,
                ),
            )
        }
        return HomeTilePresentation(
            id = tile.id,
            label = playlistName,
            subtitle = subtitle(action, typeLabel),
            icon = icon,
            action = tileAction,
            isIncomplete = incomplete,
        )
    }

    if (tile.kind == HomeTileKind.ACCOUNT_SWITCH) {
        return HomeTilePresentation(
            id = tile.id,
            label = tile.accountLabel ?: "Choose account",
            subtitle = "Switch to account",
            icon = Icons.Filled.Person,
            action = HomeTileAction.SwitchAccount(tile.accountKey),
            isIncomplete = tile.accountKey.isNullOrBlank(),
        )
    }

    val definition = requireNotNull(baseDefinition(tile.kind))
    val section = definition.sectionKind?.let { kind ->
        sections.firstOrNull { it.kind == kind } ?: defaultHomeSection(kind)
    }

    if (action == HomeTileActionMode.OPEN) {
        return HomeTilePresentation(
            id = tile.id,
            label = definition.label,
            subtitle = subtitle(HomeTileActionMode.OPEN, definition.actionTarget),
            icon = definition.icon,
            action = HomeTileAction.Link(definition.link(section)),
        )
    }

    val queueSection = requireNotNull(section) { "Queue action requires a section-backed tile" }
    return HomeTilePresentation(
        id = tile.id,
        label = definition.label,
        subtitle = subtitle(action, definition.actionTarget),
        icon = if (action == HomeTileActionMode.SHUFFLE) Icons.Filled.Shuffle else definition.icon,
        action = HomeTileAction.Queue(
            homeSectionQueueSpec(queueSection, shuffle = action == HomeTileActionMode.SHUFFLE),
        ),
    )
}

/** Queue source for a section, matching the web client's materialization. */
fun homeSectionQueueSpec(section: HomeSectionConfig, shuffle: Boolean): QueueStartSpec {
    val filters = mutableMapOf<String, JsonElement>()
    val sourceType: String
    val sourceId: String?
    val sourceName: String
    when (section.kind) {
        HomeSectionKind.CONTINUE_LISTENING -> {
            sourceType = "continueListening"
            sourceId = null
            sourceName = "Continue Listening"
        }

        HomeSectionKind.MOST_PLAYED_RECENTLY -> {
            sourceType = "mostPlayedRecently"
            sourceId = null
            sourceName = "Most Played Recently"
            filters["since"] = JsonPrimitive(mostPlayedRecentlySince(section.mostPlayedDays))
        }

        HomeSectionKind.RECENTLY_ADDED -> {
            sourceType = "albumList"
            sourceId = "newest"
            sourceName = "Recently Added"
        }

        HomeSectionKind.FORGOTTEN_FAVORITES -> {
            sourceType = "forgottenFavorites"
            sourceId = null
            sourceName = "Forgotten Favorites"
            filters["minPlays"] = JsonPrimitive(section.forgottenMinPlays)
            filters["notPlayedSinceDays"] = JsonPrimitive(section.forgottenNotPlayedDays)
        }

        HomeSectionKind.DISCOVER -> {
            sourceType = "albumList"
            sourceId = "random"
            sourceName = "Discover"
        }

        HomeSectionKind.SIMILAR_TRACKS -> {
            sourceType = "similarTracks"
            sourceId = null
            sourceName = "Similar To What You've Heard"
        }

        HomeSectionKind.TOP_ALBUMS -> {
            sourceType = "albumList"
            sourceId = "frequent"
            sourceName = "Top Albums"
            filters["since"] = JsonPrimitive(mostPlayedRecentlySince(section.topAlbumsPeriodDays))
        }

        HomeSectionKind.RECENT_ALBUMS -> {
            sourceType = "albumList"
            sourceId = "recent"
            sourceName = "Recently Played Albums"
        }

        HomeSectionKind.PLAYLIST_SONGS -> {
            sourceType = section.playlistType?.apiValue ?: "playlist"
            sourceId = section.playlistId
            sourceName = section.playlistName ?: "Playlist"
        }
    }
    return QueueStartSpec(
        sourceType = sourceType,
        sourceId = sourceId,
        sourceName = sourceName,
        filters = filters,
        shuffle = shuffle,
    )
}

fun homeSectionLabel(section: HomeSectionConfig): String = when (section.kind) {
    HomeSectionKind.CONTINUE_LISTENING -> "Continue Listening"
    HomeSectionKind.MOST_PLAYED_RECENTLY -> "Most Played Recently"
    HomeSectionKind.RECENTLY_ADDED -> "Recently Added"
    HomeSectionKind.FORGOTTEN_FAVORITES -> "Forgotten Favorites"
    HomeSectionKind.DISCOVER -> "Discover Something New"
    HomeSectionKind.SIMILAR_TRACKS -> "Similar To What You've Heard"
    HomeSectionKind.TOP_ALBUMS -> "Top Albums"
    HomeSectionKind.RECENT_ALBUMS -> "Recently Played Albums"
    HomeSectionKind.PLAYLIST_SONGS -> section.playlistName ?: "Playlist Songs"
}

fun homeSectionIcon(section: HomeSectionConfig): ImageVector = when (section.kind) {
    HomeSectionKind.CONTINUE_LISTENING -> Icons.Filled.PlayArrow
    HomeSectionKind.MOST_PLAYED_RECENTLY -> Icons.Filled.TrendingUp
    HomeSectionKind.RECENTLY_ADDED -> Icons.Filled.Schedule
    HomeSectionKind.FORGOTTEN_FAVORITES -> Icons.Filled.History
    HomeSectionKind.DISCOVER -> Icons.Filled.AutoAwesome
    HomeSectionKind.SIMILAR_TRACKS -> Icons.Filled.GraphicEq
    HomeSectionKind.TOP_ALBUMS -> Icons.Filled.TrendingUp
    HomeSectionKind.RECENT_ALBUMS -> Icons.Filled.History
    HomeSectionKind.PLAYLIST_SONGS -> Icons.AutoMirrored.Filled.QueueMusic
}

private fun subtitle(action: HomeTileActionMode, target: String): String = when (action) {
    HomeTileActionMode.PLAY -> "Play $target"
    HomeTileActionMode.SHUFFLE -> "Shuffle $target"
    HomeTileActionMode.OPEN -> "Open $target"
}
