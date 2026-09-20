package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.generated.MusicFolderInfo
import com.ferrotune.core.network.generated.MusicFolderStats
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.SmartPlaylistConditionApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmartPlaylistRulesTest {

    private fun fields() = ruleFields(
        musicFolders = listOf(
            musicFolder(1, "Main"),
            musicFolder(2, "Archive"),
        ),
        playlists = listOf(testPlaylistInFolder("playlist-1", "Chill")),
        folders = listOf(playlistFolder("folder-1", "Sets")),
    )

    @Test
    fun `dynamic fields appear only when data is available`() {
        val withoutData = ruleFields(emptyList(), emptyList(), emptyList())
        assertNull(withoutData.fieldByName("library"))
        assertNull(withoutData.fieldByName("inPlaylist"))
        assertNull(withoutData.fieldByName("inPlaylistFolder"))

        val singleFolder = ruleFields(listOf(musicFolder(1, "Main")), emptyList(), emptyList())
        assertNull(singleFolder.fieldByName("library"))

        val withData = fields()
        assertEquals("Library", withData.fieldByName("library")?.label)
        assertEquals("In Playlist", withData.fieldByName("inPlaylist")?.label)
        assertEquals("In Playlist Folder", withData.fieldByName("inPlaylistFolder")?.label)
    }

    @Test
    fun `builds typed json values`() {
        val fields = fields()

        val text = SmartConditionDraft(1, "title", "contains", text = "rain").toApiCondition(fields)!!
        assertEquals(JsonPrimitive("rain"), text.value)

        val number = SmartConditionDraft(2, "year", "gte", number = "1990").toApiCondition(fields)!!
        assertEquals(1990L, (number.value as JsonPrimitive).long)

        val boolean = SmartConditionDraft(3, "starred", "eq", boolean = true).toApiCondition(fields)!!
        assertTrue((boolean.value as JsonPrimitive).boolean)

        val enum = SmartConditionDraft(4, "coverArt", "neq", text = "any").toApiCondition(fields)!!
        assertEquals(JsonPrimitive("any"), enum.value)

        val multi = SmartConditionDraft(
            5,
            "inPlaylist",
            "eq",
            selected = setOf("playlist-1", "playlist-2"),
        ).toApiCondition(fields)!!
        assertEquals(
            JsonArray(listOf(JsonPrimitive("playlist-1"), JsonPrimitive("playlist-2"))),
            multi.value,
        )

        val library = SmartConditionDraft(6, "library", "eq", text = "2").toApiCondition(fields)!!
        assertEquals(JsonPrimitive("2"), library.value)
    }

    @Test
    fun `no-value operators skip the value`() {
        val fields = fields()

        val draft = SmartConditionDraft(1, "lastPlayed", "empty")
        val condition = draft.toApiCondition(fields)!!
        assertEquals(JsonPrimitive(true), condition.value)
    }

    @Test
    fun `incomplete conditions do not convert`() {
        val fields = fields()

        assertNull(SmartConditionDraft(1, "year", "eq", number = "").toApiCondition(fields))
        assertNull(SmartConditionDraft(2, "year", "eq", number = "abc").toApiCondition(fields))
        assertNull(SmartConditionDraft(3, "coverArt", "eq").toApiCondition(fields))
        assertNull(SmartConditionDraft(4, "inPlaylist", "eq").toApiCondition(fields))
        assertNull(SmartConditionDraft(5, "unknown", "eq", text = "x").toApiCondition(fields))
    }

    @Test
    fun `api conditions round-trip into drafts`() {
        val fields = fields()

        val textDraft = SmartPlaylistConditionApi("title", "contains", JsonPrimitive("rain"))
            .toDraft(1)
        assertEquals("rain", textDraft.text)

        val numberDraft = SmartPlaylistConditionApi("year", "gte", JsonPrimitive(1990))
            .toDraft(2)
        assertEquals("1990", numberDraft.number)

        val boolDraft = SmartPlaylistConditionApi("starred", "eq", JsonPrimitive(true))
            .toDraft(3)
        assertTrue(boolDraft.boolean)

        val multiDraft = SmartPlaylistConditionApi(
            "inPlaylist",
            "eq",
            JsonArray(listOf(JsonPrimitive("playlist-1"))),
        ).toDraft(4)
        assertEquals(setOf("playlist-1"), multiDraft.selected)

        assertEquals(
            SmartConditionDraft(5, "year", "gte", text = "1990", number = "1990"),
            SmartPlaylistConditionApi("year", "gte", JsonPrimitive(1990)).toDraft(5),
        )
        assertTrue(fields.isNotEmpty())
    }

    private fun musicFolder(id: Long, name: String) = MusicFolderInfo(
        id = id,
        name = name,
        path = "/music/$name",
        enabled = true,
        watchEnabled = true,
        stats = MusicFolderStats(
            songCount = 0,
            albumCount = 0,
            artistCount = 0,
            totalDurationSeconds = 0,
            totalSizeBytes = 0,
        ),
    )

    private fun playlistFolder(id: String, name: String) = PlaylistFolderResponse(
        id = id,
        name = name,
        parentId = null,
        position = 0,
        createdAt = "2026-01-01T00:00:00.000Z",
        hasCoverArt = false,
    )
}

internal fun testPlaylistInFolder(id: String, name: String): PlaylistInFolder = PlaylistInFolder(
    id = id,
    name = name,
    owner = "tester",
    public = false,
    position = 0,
    songCount = 0,
    duration = 0,
    sharedWithMe = false,
    canEdit = true,
    created = "2026-01-01T00:00:00.000Z",
    changed = "2026-01-01T00:00:00.000Z",
)
