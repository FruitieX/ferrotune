package com.ferrotune.feature.home.ui

import com.ferrotune.feature.home.data.HomePlaylistChoice
import com.ferrotune.feature.home.data.HomePlaylistType
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeTileActionMode
import com.ferrotune.feature.home.data.HomeTileKind

/** Display strings for the Home layout editors, matching the web settings UI. */

fun homeTileKindLabel(kind: HomeTileKind): String = when (kind) {
    HomeTileKind.FAVORITES -> "Favorites"
    HomeTileKind.HISTORY -> "Recently Played"
    HomeTileKind.FORGOTTEN_FAVORITES -> "Forgotten Favorites"
    HomeTileKind.MOST_PLAYED_RECENTLY -> "Most Played Recently"
    HomeTileKind.CONTINUE_LISTENING -> "Continue Listening"
    HomeTileKind.RECENTLY_ADDED -> "Recently Added"
    HomeTileKind.DISCOVER -> "Discover"
    HomeTileKind.SIMILAR_TRACKS -> "Similar To What You've Heard"
    HomeTileKind.PLAYLIST -> "Playlist"
    HomeTileKind.ACCOUNT_SWITCH -> "Switch Account"
}

fun homeTileKindDescription(kind: HomeTileKind): String = when (kind) {
    HomeTileKind.FAVORITES -> "Favorite songs, albums, and artists"
    HomeTileKind.HISTORY -> "Listening history"
    HomeTileKind.FORGOTTEN_FAVORITES -> "Older favorites worth revisiting"
    HomeTileKind.MOST_PLAYED_RECENTLY -> "Tracks played most in the last month"
    HomeTileKind.CONTINUE_LISTENING -> "Recent albums, playlists, and generated sources"
    HomeTileKind.RECENTLY_ADDED -> "Newly added albums"
    HomeTileKind.DISCOVER -> "Random album discovery"
    HomeTileKind.SIMILAR_TRACKS -> "Tracks similar to your recent listening"
    HomeTileKind.PLAYLIST -> "A chosen playlist or smart playlist"
    HomeTileKind.ACCOUNT_SWITCH -> "Switch to a chosen saved account"
}

fun homeTileActionLabel(mode: HomeTileActionMode): String = when (mode) {
    HomeTileActionMode.OPEN -> "Open"
    HomeTileActionMode.PLAY -> "Play"
    HomeTileActionMode.SHUFFLE -> "Shuffle"
}

fun homePlaylistChoiceLabel(choice: HomePlaylistChoice): String =
    if (choice.type == HomePlaylistType.SMART_PLAYLIST) {
        "${choice.name} (smart)"
    } else {
        choice.name
    }

fun homeSectionDescription(section: HomeSectionConfig): String = when (section.kind) {
    HomeSectionKind.CONTINUE_LISTENING -> "Recent albums, playlists, and generated sources"
    HomeSectionKind.MOST_PLAYED_RECENTLY -> "Tracks played most in a chosen recent period"
    HomeSectionKind.RECENTLY_ADDED -> "Newly added albums"
    HomeSectionKind.FORGOTTEN_FAVORITES -> "Older favorites worth revisiting"
    HomeSectionKind.DISCOVER -> "Random album discovery"
    HomeSectionKind.SIMILAR_TRACKS -> "Tracks similar to your recent listening"
    HomeSectionKind.TOP_ALBUMS -> "Albums played most in a chosen recent period"
    HomeSectionKind.RECENT_ALBUMS -> "Albums ordered by last played time"
    HomeSectionKind.PLAYLIST_SONGS -> when {
        !section.isPlaylistConfigured -> "Choose a playlist or smart playlist"
        section.playlistType == HomePlaylistType.SMART_PLAYLIST -> "Smart playlist songs"
        else -> "Playlist songs"
    }
}

fun homeSectionHasSettings(kind: HomeSectionKind): Boolean = when (kind) {
    HomeSectionKind.MOST_PLAYED_RECENTLY,
    HomeSectionKind.FORGOTTEN_FAVORITES,
    HomeSectionKind.TOP_ALBUMS,
    HomeSectionKind.PLAYLIST_SONGS,
    -> true

    else -> false
}
