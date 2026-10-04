package com.ferrotune.feature.library.data

import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.core.testing.testServerPreferences
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryViewPreferencesRepositoryTest {

    @Test
    fun `defaults to title asc when no preference is stored`() = runTest {
        val repository = LibraryViewPreferencesRepository(testServerPreferences(FakePreferencesApi()))

        repository.ensureLoaded()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
        assertEquals(SortDir.ASC, repository.sort.value.songDir())
        assertEquals(AlbumSort.NAME, repository.sort.value.albumSort())
        assertEquals(ArtistSort.NAME, repository.sort.value.artistSort())
    }

    @Test
    fun `load parses stored per-tab sort preferences`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[LibraryViewPreferencesRepository.PREFERENCE_KEY] = JsonPrimitive(
                """
                {"songs":{"field":"playCount","direction":"desc"},
                 "albums":{"field":"year","direction":"desc"},
                 "artists":{"field":"albumCount","direction":"asc"}}
                """.trimIndent(),
            )
        }
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.ensureLoaded()

        assertEquals(SongSort.PLAY_COUNT, repository.sort.value.songSort())
        assertEquals(SortDir.DESC, repository.sort.value.songDir())
        assertEquals(AlbumSort.YEAR, repository.sort.value.albumSort())
        assertEquals(SortDir.DESC, repository.sort.value.albumDir())
        assertEquals(ArtistSort.ALBUM_COUNT, repository.sort.value.artistSort())
    }

    @Test
    fun `malformed preference falls back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[LibraryViewPreferencesRepository.PREFERENCE_KEY] =
                JsonPrimitive("not json")
        }
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.ensureLoaded()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
    }

    @Test
    fun `tabs missing a field fall back to that tab's default`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[LibraryViewPreferencesRepository.PREFERENCE_KEY] = JsonPrimitive(
                """{"songs":{"direction":"desc"},"albums":{"direction":"desc"},"artists":{}}""",
            )
        }
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.ensureLoaded()

        val sort = repository.sort.value
        assertEquals(SongSort.TITLE.apiValue, sort.songs.field)
        assertEquals(AlbumSort.NAME.apiValue, sort.albums.field)
        assertEquals(SortDir.DESC, sort.albumDir())
        assertEquals(ArtistSort.NAME.apiValue, sort.artists.field)
    }

    @Test
    fun `unknown sort fields fall back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[LibraryViewPreferencesRepository.PREFERENCE_KEY] = JsonPrimitive(
                """{"songs":{"field":"nonsense","direction":"sideways"}}""",
            )
        }
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.ensureLoaded()

        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
        assertEquals(SortDir.ASC, repository.sort.value.songDir())
    }

    @Test
    fun `setters persist and update local state`() = runTest {
        val api = FakePreferencesApi()
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.setSongSort(SongSort.DATE_ADDED, SortDir.DESC)
        repository.setAlbumSort(AlbumSort.SONG_COUNT, SortDir.DESC)
        repository.setArtistSort(ArtistSort.LAST_PLAYED, SortDir.DESC)

        val stored =
            api.preferenceValues[LibraryViewPreferencesRepository.PREFERENCE_KEY] as JsonPrimitive
        val text = stored.content
        assertEquals(true, text.contains("\"dateAdded\""))
        assertEquals(true, text.contains("\"songCount\""))
        assertEquals(true, text.contains("\"lastPlayed\""))
        assertEquals(SongSort.DATE_ADDED, repository.sort.value.songSort())
        assertEquals(SortDir.DESC, repository.sort.value.songDir())
        assertEquals(AlbumSort.SONG_COUNT, repository.sort.value.albumSort())
        assertEquals(ArtistSort.LAST_PLAYED, repository.sort.value.artistSort())
    }

    @Test
    fun `ignores and never writes the web-owned library-sort key`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues["library-sort"] = JsonPrimitive(
                """{"field":"playCount","direction":"desc"}""",
            )
        }
        val repository = LibraryViewPreferencesRepository(testServerPreferences(api))

        repository.ensureLoaded()
        assertEquals(SongSort.TITLE, repository.sort.value.songSort())
        assertEquals(SortDir.ASC, repository.sort.value.songDir())

        repository.setSongSort(SongSort.ALBUM, SortDir.DESC)

        assertEquals(listOf(LibraryViewPreferencesRepository.PREFERENCE_KEY), api.writtenKeys)
    }
}
