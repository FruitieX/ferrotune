package com.ferrotune.feature.library.data

import com.ferrotune.core.network.ViewSortConfig
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakePreferencesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ViewSortPreferencesRepositoryTest {

    private val historyDefault = ViewSortConfig("lastPlayed", "desc")

    @Test
    fun `defaults are returned when no preference is stored`() = runTest {
        val repository = ViewSortPreferencesRepository(FakeApiProvider(FakePreferencesApi()))

        repository.load()

        assertEquals(historyDefault, repository.config(ViewSortKey.HISTORY, historyDefault))
    }

    @Test
    fun `load parses stored per-view sorts`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.ALBUM_DETAIL.preferenceKey] = JsonPrimitive(
                """{"field":"year","direction":"desc"}""",
            )
            preferenceValues[ViewSortKey.HISTORY.preferenceKey] = JsonPrimitive(
                """{"field":"playCount","direction":"asc"}""",
            )
        }
        val repository = ViewSortPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(
            ViewSortConfig("year", "desc"),
            repository.config(ViewSortKey.ALBUM_DETAIL, ViewSortConfig("custom", "asc")),
        )
        assertEquals(
            ViewSortConfig("playCount", "asc"),
            repository.config(ViewSortKey.HISTORY, historyDefault),
        )
    }

    @Test
    fun `malformed and unknown-shaped preferences fall back to defaults`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.ALBUM_DETAIL.preferenceKey] = JsonPrimitive("not json")
            preferenceValues[ViewSortKey.HISTORY.preferenceKey] = JsonPrimitive("""{"field":"name"}""")
        }
        val repository = ViewSortPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(
            ViewSortConfig("custom", "asc"),
            repository.config(ViewSortKey.ALBUM_DETAIL, ViewSortConfig("custom", "asc")),
        )
        assertEquals(historyDefault, repository.config(ViewSortKey.HISTORY, historyDefault))
    }

    @Test
    fun `setSort persists the native key and updates local state`() = runTest {
        val api = FakePreferencesApi()
        val repository = ViewSortPreferencesRepository(FakeApiProvider(api))

        repository.setSort(ViewSortKey.PLAYLIST_DETAIL, "dateAdded", "desc")

        assertEquals(listOf(ViewSortKey.PLAYLIST_DETAIL.preferenceKey), api.writtenKeys)
        val stored = api.preferenceValues[ViewSortKey.PLAYLIST_DETAIL.preferenceKey] as JsonPrimitive
        assertEquals("""{"field":"dateAdded","direction":"desc"}""", stored.content)
        assertEquals(
            ViewSortConfig("dateAdded", "desc"),
            repository.config(ViewSortKey.PLAYLIST_DETAIL, ViewSortConfig("custom", "asc")),
        )
    }

    @Test
    fun `invalidate forces a reload on the next ensureLoaded`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues[ViewSortKey.HISTORY.preferenceKey] = JsonPrimitive(
                """{"field":"name","direction":"asc"}""",
            )
        }
        val repository = ViewSortPreferencesRepository(FakeApiProvider(api))

        repository.ensureLoaded()
        assertEquals(
            ViewSortConfig("name", "asc"),
            repository.config(ViewSortKey.HISTORY, historyDefault),
        )

        api.preferenceValues[ViewSortKey.HISTORY.preferenceKey] = JsonPrimitive(
            """{"field":"duration","direction":"desc"}""",
        )
        repository.invalidate()
        repository.ensureLoaded()

        assertEquals(
            ViewSortConfig("duration", "desc"),
            repository.config(ViewSortKey.HISTORY, historyDefault),
        )
    }

    @Test
    fun `never reads or writes web-owned sort keys`() = runTest {
        val api = FakePreferencesApi().apply {
            preferenceValues["library-sort"] = JsonPrimitive(
                """{"field":"playCount","direction":"desc"}""",
            )
            preferenceValues["playlist-sort"] = JsonPrimitive(
                """{"field":"name","direction":"desc"}""",
            )
        }
        val repository = ViewSortPreferencesRepository(FakeApiProvider(api))

        repository.load()

        assertEquals(historyDefault, repository.config(ViewSortKey.HISTORY, historyDefault))
        assertEquals(
            ViewSortConfig("custom", "asc"),
            repository.config(ViewSortKey.PLAYLIST_DETAIL, ViewSortConfig("custom", "asc")),
        )

        repository.setSort(ViewSortKey.HISTORY, "name", "asc")

        assertEquals(listOf(ViewSortKey.HISTORY.preferenceKey), api.writtenKeys)
    }
}
