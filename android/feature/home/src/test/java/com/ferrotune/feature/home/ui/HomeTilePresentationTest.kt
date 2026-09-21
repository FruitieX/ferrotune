package com.ferrotune.feature.home.ui

import com.ferrotune.feature.home.data.HomePlaylistType
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeTileActionMode
import com.ferrotune.feature.home.data.HomeTileConfig
import com.ferrotune.feature.home.data.HomeTileKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeTilePresentationTest {

    @Test
    fun `favorites tile opens favorites`() {
        val tile = HomeTileConfig(
            id = "favorites",
            kind = HomeTileKind.FAVORITES,
            action = HomeTileActionMode.OPEN,
        )

        val presentation = homeTilePresentation(tile)

        assertEquals("Favorites", presentation.label)
        assertEquals(HomeTileAction.Link(HomeLinkTarget.Favorites), presentation.action)
        assertFalse(presentation.isIncomplete)
    }

    @Test
    fun `favorites tile shuffle queues the favorites source`() {
        val tile = HomeTileConfig(
            id = "favorites",
            kind = HomeTileKind.FAVORITES,
            action = HomeTileActionMode.SHUFFLE,
        )

        val presentation = homeTilePresentation(tile)
        val action = presentation.action as HomeTileAction.Queue

        assertEquals("favorites", action.spec.sourceType)
        assertEquals("Favorites", action.spec.sourceName)
        assertTrue(action.spec.shuffle)
    }

    @Test
    fun `history tile play queues the history source`() {
        val tile = HomeTileConfig(
            id = "history",
            kind = HomeTileKind.HISTORY,
            action = HomeTileActionMode.PLAY,
        )

        val presentation = homeTilePresentation(tile)
        val action = presentation.action as HomeTileAction.Queue

        assertEquals("history", action.spec.sourceType)
        assertEquals("Recently Played", action.spec.sourceName)
        assertFalse(action.spec.shuffle)
    }

    @Test
    fun `section tile open links to the configured section`() {
        val section = HomeSectionConfig(
            id = "most-played",
            kind = HomeSectionKind.MOST_PLAYED_RECENTLY,
            mostPlayedRecentlyDays = 7,
        )
        val tile = HomeTileConfig(
            id = "most-played-tile",
            kind = HomeTileKind.MOST_PLAYED_RECENTLY,
            action = HomeTileActionMode.OPEN,
        )

        val presentation = homeTilePresentation(tile, listOf(section))

        assertEquals(HomeTileAction.Link(HomeLinkTarget.Section("most-played")), presentation.action)
    }

    @Test
    fun `section tile play queues with the section filters`() {
        val tile = HomeTileConfig(
            id = "forgotten",
            kind = HomeTileKind.FORGOTTEN_FAVORITES,
            action = HomeTileActionMode.PLAY,
        )

        val presentation = homeTilePresentation(tile)
        val action = presentation.action as HomeTileAction.Queue

        assertEquals("forgottenFavorites", action.spec.sourceType)
        assertEquals(10, action.spec.filters["minPlays"]?.toString()?.toInt())
        assertEquals(90, action.spec.filters["notPlayedSinceDays"]?.toString()?.toInt())
        assertFalse(action.spec.shuffle)
    }

    @Test
    fun `playlist tile shuffle queues the playlist`() {
        val tile = HomeTileConfig(
            id = "playlist-tile",
            kind = HomeTileKind.PLAYLIST,
            action = HomeTileActionMode.SHUFFLE,
            playlistId = "playlist-1",
            playlistName = "Road trip",
            playlistType = HomePlaylistType.PLAYLIST,
        )

        val presentation = homeTilePresentation(tile)
        val action = presentation.action as HomeTileAction.Queue

        assertEquals("Road trip", presentation.label)
        assertEquals("playlist", action.spec.sourceType)
        assertEquals("playlist-1", action.spec.sourceId)
        assertTrue(action.spec.shuffle)
        assertFalse(presentation.isIncomplete)
    }

    @Test
    fun `playlist tile open links to the playlist page`() {
        val tile = HomeTileConfig(
            id = "playlist-tile",
            kind = HomeTileKind.PLAYLIST,
            action = HomeTileActionMode.OPEN,
            playlistId = "playlist-1",
            playlistName = "Road trip",
            playlistType = HomePlaylistType.PLAYLIST,
        )

        val presentation = homeTilePresentation(tile)

        assertEquals(
            HomeTileAction.Link(HomeLinkTarget.Playlist("playlist-1")),
            presentation.action,
        )
    }

    @Test
    fun `smart playlist tile open links to the smart playlist page`() {
        val tile = HomeTileConfig(
            id = "smart-tile",
            kind = HomeTileKind.PLAYLIST,
            action = HomeTileActionMode.OPEN,
            playlistId = "smart-1",
            playlistName = "Fresh",
            playlistType = HomePlaylistType.SMART_PLAYLIST,
        )

        val presentation = homeTilePresentation(tile)

        assertEquals(
            HomeTileAction.Link(HomeLinkTarget.SmartPlaylist("smart-1")),
            presentation.action,
        )
    }

    @Test
    fun `unconfigured playlist tile is incomplete`() {
        val tile = HomeTileConfig(id = "playlist-tile", kind = HomeTileKind.PLAYLIST)

        val presentation = homeTilePresentation(tile)

        assertTrue(presentation.isIncomplete)
        assertEquals("Choose playlist", presentation.label)
    }

    @Test
    fun `account switch tile carries the account key`() {
        val tile = HomeTileConfig(
            id = "switch",
            kind = HomeTileKind.ACCOUNT_SWITCH,
            accountKey = "other@http://localhost:4040",
            accountLabel = "Other",
        )

        val presentation = homeTilePresentation(tile)

        assertEquals("Other", presentation.label)
        assertEquals(
            HomeTileAction.SwitchAccount("other@http://localhost:4040"),
            presentation.action,
        )
        assertFalse(presentation.isIncomplete)
    }

    @Test
    fun `account switch tile without an account is incomplete`() {
        val tile = HomeTileConfig(id = "switch", kind = HomeTileKind.ACCOUNT_SWITCH)

        val presentation = homeTilePresentation(tile)

        assertTrue(presentation.isIncomplete)
        assertEquals(HomeTileAction.SwitchAccount(null), presentation.action)
    }

    @Test
    fun `section queue spec maps album list sections`() {
        val recentlyAdded = homeSectionQueueSpec(
            HomeSectionConfig(id = "recently-added", kind = HomeSectionKind.RECENTLY_ADDED),
            shuffle = false,
        )
        assertEquals("albumList", recentlyAdded.sourceType)
        assertEquals("newest", recentlyAdded.sourceId)

        val discover = homeSectionQueueSpec(
            HomeSectionConfig(id = "discover", kind = HomeSectionKind.DISCOVER),
            shuffle = true,
        )
        assertEquals("albumList", discover.sourceType)
        assertEquals("random", discover.sourceId)
        assertTrue(discover.shuffle)

        val topAlbums = homeSectionQueueSpec(
            HomeSectionConfig(
                id = "top-albums",
                kind = HomeSectionKind.TOP_ALBUMS,
                topAlbumsDays = 30,
            ),
            shuffle = false,
        )
        assertEquals("albumList", topAlbums.sourceType)
        assertEquals("frequent", topAlbums.sourceId)
        assertTrue(topAlbums.filters.containsKey("since"))
    }

    @Test
    fun `section queue spec maps playlist sections`() {
        val spec = homeSectionQueueSpec(
            HomeSectionConfig(
                id = "playlist-section",
                kind = HomeSectionKind.PLAYLIST_SONGS,
                playlistId = "smart-1",
                playlistName = "Fresh",
                playlistType = HomePlaylistType.SMART_PLAYLIST,
            ),
            shuffle = false,
        )

        assertEquals("smartPlaylist", spec.sourceType)
        assertEquals("smart-1", spec.sourceId)
        assertEquals("Fresh", spec.sourceName)
    }

    @Test
    fun `playlist section label falls back to the playlist name`() {
        assertEquals(
            "Road trip",
            homeSectionLabel(
                HomeSectionConfig(
                    id = "playlist-section",
                    kind = HomeSectionKind.PLAYLIST_SONGS,
                    playlistName = "Road trip",
                ),
            ),
        )
        assertEquals(
            "Playlist Songs",
            homeSectionLabel(
                HomeSectionConfig(id = "playlist-section", kind = HomeSectionKind.PLAYLIST_SONGS),
            ),
        )
    }

    @Test
    fun `continue listening section spec has no filters`() {
        val spec = homeSectionQueueSpec(
            HomeSectionConfig(id = "continue-listening", kind = HomeSectionKind.CONTINUE_LISTENING),
            shuffle = false,
        )

        assertEquals("continueListening", spec.sourceType)
        assertNull(spec.sourceId)
        assertTrue(spec.filters.isEmpty())
    }
}
