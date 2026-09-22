package com.ferrotune.core.network

import com.ferrotune.core.network.generated.SearchParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueryMapTest {

    @Test
    fun `omits null fields and renders scalars`() {
        val params = SearchParams(
            query = "*",
            songCount = 50,
            songOffset = 100,
            starredOnly = true,
        ).toQueryMap()

        assertEquals("*", params["query"])
        assertEquals("50", params["songCount"])
        assertEquals("100", params["songOffset"])
        assertEquals("true", params["starredOnly"])
        assertFalse(params.containsKey("genre"))
        assertFalse(params.containsKey("minYear"))
    }

    @Test
    fun `keeps false booleans and empty strings`() {
        val params = SearchParams(
            query = "*",
            starredOnly = false,
            titleFilter = "",
        ).toQueryMap()

        assertTrue(params.containsKey("starredOnly"))
        assertEquals("false", params["starredOnly"])
        assertEquals("", params["titleFilter"])
    }
}
