package com.ferrotune.feature.library.data

import com.ferrotune.core.network.generated.SearchParams
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryFiltersTest {
    private val filters = LibraryFilters(
        minYear = 1990,
        maxYear = 1999,
        genre = "Rock",
        minRating = 3,
        starredOnly = true,
        minBitrate = 256,
        fileFormat = "flac",
        missingCoverArt = true,
    )

    @Test
    fun `applyTo fills the search params and keeps a favorites-only request`() {
        val params = LibraryFilters(minYear = 2000).applyTo(SearchParams(query = "*", starredOnly = true))

        assertEquals(2000, params.minYear)
        assertEquals(true, params.starredOnly)
        assertNull(params.missingCoverArt)
        assertEquals(true, filters.applyTo(SearchParams(query = "*")).missingCoverArt)
    }

    @Test
    fun `albums and artists only carry the fields the web sends them`() {
        assertEquals(
            LibraryFilters(minYear = 1990, maxYear = 1999, genre = "Rock", minRating = 3, starredOnly = true),
            filters.forAlbums(),
        )
        assertEquals(LibraryFilters(minRating = 3, starredOnly = true), filters.forArtists())
        assertFalse(LibraryFilters(minBitrate = 128).forArtists().isActive)
    }

    @Test
    fun `queue filters use the server's keys and skip unset values`() {
        val queue = filters.toQueueFilters()

        assertEquals(JsonPrimitive(1990), queue["minYear"])
        assertEquals(JsonPrimitive("Rock"), queue["genre"])
        assertEquals(JsonPrimitive(true), queue["missingCoverArt"])
        assertFalse("maxRating" in queue)
        assertFalse("disabledOnly" in queue)
        assertTrue(LibraryFilters.NONE.toQueueFilters().isEmpty())
    }

    @Test
    fun `badges describe ranges and remove their own filter`() {
        val badges = LibraryFilters(minYear = 1990, maxYear = 1999, minDuration = 125, starredOnly = true).badges()

        assertEquals(listOf("Year: 1990–1999", "Duration ≥ 2:05", "Favorites"), badges.map { it.label })
        assertEquals(LibraryFilters(minDuration = 125, starredOnly = true), badges.first().without)
    }

    @Test
    fun `smart playlist rules follow the web mapping`() {
        val rules = LibraryFilters(
            minYear = 1990,
            maxRating = 4,
            starredOnly = true,
            addedAfter = "2024-01-01",
            missingCoverArt = true,
        ).toSmartPlaylistConditions()

        assertEquals(
            listOf(
                Triple("year", "gte", JsonPrimitive(1990)),
                Triple("rating", "lte", JsonPrimitive(4)),
                Triple("starred", "eq", JsonPrimitive(true)),
                Triple("dateAdded", "gt", JsonPrimitive("2024-01-01")),
                Triple("coverArt", "neq", JsonPrimitive("any")),
            ),
            rules.map { Triple(it.field, it.operator, it.value) },
        )
        assertTrue(LibraryFilters.NONE.toSmartPlaylistConditions().isEmpty())
    }
}
