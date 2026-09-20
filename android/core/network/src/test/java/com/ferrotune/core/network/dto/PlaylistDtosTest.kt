package com.ferrotune.core.network.dto

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.generated.SmartPlaylistConditionApi
import com.ferrotune.core.network.generated.UpdateSmartPlaylistRequest
import com.ferrotune.core.network.toQueryMap

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PlaylistDtosTest {

    @Test
    fun `smart playlist conditions serialize scalar values`() {
        val condition = SmartPlaylistConditionApi(
            field = "genre",
            operator = "eq",
            value = JsonPrimitive("Rock"),
        )

        val json = FerrotuneJson.encodeToJsonElement(condition).toString()

        assertEquals(
            """{"field":"genre","operator":"eq","value":"Rock"}""",
            json,
        )
    }

    @Test
    fun `smart playlist conditions serialize multi-select values`() {
        val condition = SmartPlaylistConditionApi(
            field = "inPlaylist",
            operator = "eq",
            value = JsonArray(listOf(JsonPrimitive("playlist-1"), JsonPrimitive("playlist-2"))),
        )

        val json = FerrotuneJson.encodeToJsonElement(condition).toString()

        assertEquals(
            """{"field":"inPlaylist","operator":"eq","value":["playlist-1","playlist-2"]}""",
            json,
        )
    }

    @Test
    fun `smart playlist conditions serialize numeric and boolean values`() {
        val numeric = SmartPlaylistConditionApi("year", "gte", JsonPrimitive(1990))
        val boolean = SmartPlaylistConditionApi("starred", "eq", JsonPrimitive(true))

        assertEquals("""{"field":"year","operator":"gte","value":1990}""", FerrotuneJson.encodeToJsonElement(numeric).toString())
        assertEquals("""{"field":"starred","operator":"eq","value":true}""", FerrotuneJson.encodeToJsonElement(boolean).toString())
    }

    @Test
    fun `smart playlist update omits tri-state fields when untouched`() {
        val body = FerrotuneJson.encodeToJsonElement(UpdateSmartPlaylistRequest(name = "Mix"))
            .jsonObject

        assertEquals("Mix", body["name"]?.let { (it as JsonPrimitive).content })
        assertFalse(body.containsKey("maxSongs"))
        assertFalse(body.containsKey("folderId"))
    }

    @Test
    fun `smart playlist update encodes explicit nulls to clear tri-state fields`() {
        val body = FerrotuneJson.encodeToJsonElement(
            UpdateSmartPlaylistRequest(folderId = JsonNull, maxSongs = JsonNull)
        ).jsonObject

        assertEquals(JsonNull, body["folderId"])
        assertEquals(JsonNull, body["maxSongs"])
    }

    @Test
    fun `smart playlist update encodes new tri-state values`() {
        val body = FerrotuneJson.encodeToJsonElement(
            UpdateSmartPlaylistRequest(
                maxSongs = JsonPrimitive(25),
                folderId = JsonPrimitive("folder-1"),
            )
        ).jsonObject

        assertEquals(JsonPrimitive(25), body["maxSongs"])
        assertEquals(JsonPrimitive("folder-1"), body["folderId"])
    }

    @Test
    fun `folder update omits parent when untouched and clears with null`() {
        val untouched = FerrotuneJson.encodeToJsonElement(UpdateFolderRequest(name = "Chill"))
            .jsonObject
        val cleared = FerrotuneJson.encodeToJsonElement(UpdateFolderRequest(parentId = JsonNull))
            .jsonObject
        val moved = FerrotuneJson.encodeToJsonElement(UpdateFolderRequest(parentId = JsonPrimitive("folder-2")))
            .jsonObject

        assertFalse(untouched.containsKey("parentId"))
        assertEquals(JsonNull, cleared["parentId"])
        assertEquals(JsonPrimitive("folder-2"), moved["parentId"])
    }

    @Test
    fun `playlist song query params omit nulls and keep zeros`() {
        val params = GetPlaylistSongsParams(
            offset = 0,
            count = 50,
            sort = "custom",
            entryType = "song",
        ).toQueryMap()

        assertEquals("0", params["offset"])
        assertEquals("50", params["count"])
        assertEquals("custom", params["sort"])
        assertEquals("song", params["entryType"])
        assertFalse(params.containsKey("sortDir"))
        assertFalse(params.containsKey("filter"))
        assertFalse(params.containsKey("inlineImages"))
    }

    @Test
    fun `home params render booleans and seeds`() {
        val params = HomePageParams(
            size = 15,
            discoverSeed = 7,
            includeContinueListening = false,
        ).toQueryMap()

        assertEquals("15", params["size"])
        assertEquals("7", params["discoverSeed"])
        assertEquals("false", params["includeContinueListening"])
        assertFalse(params.containsKey("includeDiscover"))
    }
}
