package com.ferrotune.feature.library.data

import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryViewPreferencesRepositoryTest {

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

    @Test
    fun `defaults to title asc when no preference is stored`() = runTest {
        val repository = LibraryViewPreferencesRepository(FakeApiProvider(FakePreferencesApi()))

        repository.load()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
        assertEquals(SortDir.ASC, repository.sort.value.songDir())
        assertEquals(AlbumSort.NAME, repository.sort.value.albumSort())
        assertEquals(ArtistSort.NAME, repository.sort.value.artistSort())
    }

    @Test
    fun `load parses stored per-tab sort preferences`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues["library-sort"] = JsonPrimitive(
                """
                {"songs":{"field":"playCount","direction":"desc"},
                 "albums":{"field":"year","direction":"desc"},
                 "artists":{"field":"albumCount","direction":"asc"}}
                """.trimIndent(),
            )
        }
        val repository = LibraryViewPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(SongSort.PLAY_COUNT, repository.sort.value.songSort())
        assertEquals(SortDir.DESC, repository.sort.value.songDir())
        assertEquals(AlbumSort.YEAR, repository.sort.value.albumSort())
        assertEquals(SortDir.DESC, repository.sort.value.albumDir())
        assertEquals(ArtistSort.ALBUM_COUNT, repository.sort.value.artistSort())
    }

    @Test
    fun `malformed preference falls back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues["library-sort"] = JsonPrimitive("not json")
        }
        val repository = LibraryViewPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
    }

    @Test
    fun `unknown sort fields fall back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues["library-sort"] = JsonPrimitive(
                """{"songs":{"field":"nonsense","direction":"sideways"}}""",
            )
        }
        val repository = LibraryViewPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
        assertEquals(SortDir.ASC, repository.sort.value.songDir())
    }

    @Test
    fun `setters persist and update local state`() = runTest {
        val api = FakePreferencesApi()
        val repository = LibraryViewPreferencesRepository(FakeApiProvider(api))

        repository.setSongSort(SongSort.DATE_ADDED, SortDir.DESC)
        repository.setAlbumSort(AlbumSort.SONG_COUNT, SortDir.DESC)
        repository.setArtistSort(ArtistSort.LAST_PLAYED, SortDir.DESC)

        val stored = api.preferenceValues["library-sort"] as JsonPrimitive
        val text = stored.content
        assertEquals(true, text.contains("\"dateAdded\""))
        assertEquals(true, text.contains("\"songCount\""))
        assertEquals(true, text.contains("\"lastPlayed\""))
        assertEquals(SongSort.DATE_ADDED, repository.sort.value.songSort())
        assertEquals(SortDir.DESC, repository.sort.value.songDir())
        assertEquals(AlbumSort.SONG_COUNT, repository.sort.value.albumSort())
        assertEquals(ArtistSort.LAST_PLAYED, repository.sort.value.artistSort())
    }
}
