package com.ferrotune.feature.library.ui

import com.ferrotune.feature.library.data.LibraryFilters
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdvancedFiltersTest {
    @Test
    fun `draft round-trips filters and drops blank fields`() {
        val filters = LibraryFilters(minYear = 1990, genre = "Jazz", maxRating = 4, addedAfter = "2024-01-31", disabledOnly = true)

        assertEquals(filters, FilterDraft.from(filters).toFilters())
        assertEquals(LibraryFilters.NONE, FilterDraft(genre = "  ").toFilters())
    }

    @Test
    fun `draft validates numbers and dates before applying`() {
        assertTrue(FilterDraft(minYear = "1990", addedAfter = "2024-01-31").isValid)
        assertFalse(FilterDraft(minYear = "19x0").isValid)
        assertFalse(FilterDraft(maxPlayCount = "-1").isValid)
        assertFalse(FilterDraft(addedBefore = "31.1.2024").isValid)
    }

    @Test
    fun `scopes narrow filters to the tab's fields`() {
        val filters = LibraryFilters(minYear = 2000, minBitrate = 320, starredOnly = true)

        assertEquals(filters, filters.forScope(FilterScope.SONGS))
        assertEquals(LibraryFilters(minYear = 2000, starredOnly = true), filters.forScope(FilterScope.ALBUMS))
        assertEquals(LibraryFilters(starredOnly = true), filters.forScope(FilterScope.ARTISTS))
    }
}
