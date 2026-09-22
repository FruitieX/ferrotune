package com.ferrotune.feature.home.data

import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeLayoutPreferencesRepositoryTest {

    private class FakePreferencesApi : FakeFerrotuneApi() {
        val preferenceValues = mutableMapOf<String, JsonElement>()

        override suspend fun preferences(): PreferencesResponse = PreferencesResponse(
            accentColor = "rust",
            preferences = preferenceValues.toMap(),
        )

        override suspend fun setPreference(
            key: String,
            request: SetPreferenceRequest,
        ): GetPreferenceResponse {
            preferenceValues[key] = request.value
            return GetPreferenceResponse(key = key, value = request.value)
        }
    }

    private fun repository(api: FakePreferencesApi = FakePreferencesApi()) =
        HomeLayoutPreferencesRepository(FakeApiProvider(api))

    @Test
    fun `defaults when nothing is stored`() = runTest {
        val repository = repository()

        repository.load()

        assertEquals(
            listOf(HomeTileKind.FAVORITES, HomeTileKind.HISTORY),
            repository.tiles.value.map { it.kind },
        )
        assertEquals(
            DEFAULT_HOME_SECTIONS.map { it.kind },
            repository.sections.value.map { it.kind },
        )
        assertEquals(false, repository.sections.value.first { it.kind == HomeSectionKind.TOP_ALBUMS }.enabled)
    }

    @Test
    fun `parses stored tiles including playlist and account switch`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[HomeLayoutPreferencesRepository.KEY_TILES] = JsonArray(
                listOf(
                    JsonPrimitive("ignored"),
                    jsonTile(
                        """{"id":"playlist-1","kind":"playlist","action":"shuffle","playlistId":"p1",
                            "playlistName":"Road Trip","playlistType":"smartPlaylist"}""",
                    ),
                    jsonTile(
                        """{"id":"accountSwitch-1","kind":"accountSwitch",
                            "accountKey":"2@https://music.example.com",
                            "accountLabel":"other@music.example.com"}""",
                    ),
                ),
            )
        }
        val repository = repository(api)

        repository.load()

        val tiles = repository.tiles.value
        assertEquals(2, tiles.size)
        assertEquals(HomeTileKind.PLAYLIST, tiles[0].kind)
        assertEquals(HomeTileActionMode.SHUFFLE, tiles[0].action)
        assertEquals(HomePlaylistType.SMART_PLAYLIST, tiles[0].playlistType)
        assertEquals("Road Trip", tiles[0].playlistName)
        assertEquals(HomeTileKind.ACCOUNT_SWITCH, tiles[1].kind)
        assertNull(tiles[1].effectiveAction)
        assertEquals("2@https://music.example.com", tiles[1].accountKey)
    }

    @Test
    fun `parses stored sections and appends missing defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[HomeLayoutPreferencesRepository.KEY_SECTIONS] = JsonArray(
                listOf(
                    jsonTile(
                        """{"id":"continue-listening","kind":"continueListening","enabled":false}""",
                    ),
                    jsonTile(
                        """{"id":"custom","kind":"playlistSongs","enabled":true,"playlistId":"p9",
                            "playlistName":"Custom","playlistType":"playlist"}""",
                    ),
                    jsonTile("""{"id":"bogus","kind":"notAKind","enabled":true}"""),
                ),
            )
        }
        val repository = repository(api)

        repository.load()

        val sections = repository.sections.value
        assertEquals(HomeSectionKind.CONTINUE_LISTENING, sections[0].kind)
        assertEquals(false, sections[0].enabled)
        assertEquals(HomeSectionKind.PLAYLIST_SONGS, sections[1].kind)
        assertEquals("Custom", sections[1].playlistName)
        assertEquals(1, sections.count { it.kind == HomeSectionKind.CONTINUE_LISTENING })
        assertEquals(
            DEFAULT_HOME_SECTIONS.size,
            sections.count { it.kind != HomeSectionKind.PLAYLIST_SONGS },
        )
    }

    @Test
    fun `writes the web-compatible JSON shapes`() = runTest {
        val api = FakePreferencesApi()
        val repository = repository(api)

        repository.setTiles(
            listOf(
                createHomeTile(
                    kind = HomeTileKind.PLAYLIST,
                    action = HomeTileActionMode.PLAY,
                    playlistId = "p1",
                    playlistName = "Road Trip",
                    playlistType = HomePlaylistType.PLAYLIST,
                    id = "playlist-fixed",
                ),
                createHomeTile(
                    kind = HomeTileKind.ACCOUNT_SWITCH,
                    accountKey = "2@https://music.example.com",
                    accountLabel = "other@music.example.com",
                    id = "accountSwitch-fixed",
                ),
            ),
        )
        repository.setSections(
            listOf(
                createPlaylistHomeSection(
                    playlistId = "p2",
                    playlistName = "Focus",
                    playlistType = HomePlaylistType.SMART_PLAYLIST,
                    id = "playlist-songs-fixed",
                ),
            ),
        )

        val tiles = api.preferenceValues.getValue(HomeLayoutPreferencesRepository.KEY_TILES)
            .jsonArray
        assertEquals(2, tiles.size)
        val playlistTile = tiles[0].jsonObject
        assertEquals("playlist-fixed", playlistTile.getValue("id").jsonPrimitive.content)
        assertEquals("playlist", playlistTile.getValue("kind").jsonPrimitive.content)
        assertEquals("play", playlistTile.getValue("action").jsonPrimitive.content)
        assertEquals("p1", playlistTile.getValue("playlistId").jsonPrimitive.content)
        val accountTile = tiles[1].jsonObject
        assertEquals("accountSwitch", accountTile.getValue("kind").jsonPrimitive.content)
        assertEquals(false, accountTile.containsKey("action"))
        assertEquals(
            "2@https://music.example.com",
            accountTile.getValue("accountKey").jsonPrimitive.content,
        )

        val sections = api.preferenceValues.getValue(HomeLayoutPreferencesRepository.KEY_SECTIONS)
            .jsonArray
        val custom = sections.first { it.jsonObject.getValue("kind").jsonPrimitive.content == "playlistSongs" }
            .jsonObject
        assertEquals("smartPlaylist", custom.getValue("playlistType").jsonPrimitive.content)
        assertEquals("Focus", custom.getValue("playlistName").jsonPrimitive.content)
        assertTrue(sections.any { it.jsonObject.getValue("kind").jsonPrimitive.content == "continueListening" })
    }

    @Test
    fun `non-array stored value falls back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[HomeLayoutPreferencesRepository.KEY_TILES] = JsonPrimitive("nonsense")
            preferenceValues[HomeLayoutPreferencesRepository.KEY_SECTIONS] = JsonPrimitive("{}")
        }
        val repository = repository(api)

        repository.load()

        assertEquals(DEFAULT_HOME_TILES.map { it.kind }, repository.tiles.value.map { it.kind })
        assertEquals(DEFAULT_HOME_SECTIONS.size, repository.sections.value.size)
    }

    @Test
    fun `invalidate makes the next load pick up new values`() = runTest {
        val api = FakePreferencesApi()
        val repository = repository(api)
        repository.load()
        assertEquals(DEFAULT_HOME_TILES.size, repository.tiles.value.size)

        api.preferenceValues[HomeLayoutPreferencesRepository.KEY_TILES] = JsonArray(
            listOf(jsonTile("""{"id":"history","kind":"history","action":"shuffle"}""")),
        )
        repository.invalidate()
        repository.load()

        assertEquals(listOf(HomeTileKind.HISTORY), repository.tiles.value.map { it.kind })
        assertEquals(HomeTileActionMode.SHUFFLE, repository.tiles.value.single().action)
    }

    private fun jsonTile(value: String): JsonElement =
        kotlinx.serialization.json.Json.parseToJsonElement(value.trimIndent())
}
