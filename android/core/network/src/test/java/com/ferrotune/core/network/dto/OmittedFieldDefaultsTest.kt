package com.ferrotune.core.network.dto

import com.ferrotune.core.network.FerrotuneJson
import com.ferrotune.core.network.generated.FerrotuneSearchResponse
import com.ferrotune.core.network.generated.FerrotuneStarredResponse
import com.ferrotune.core.network.generated.GetTagsResponse
import com.ferrotune.core.network.generated.MatchResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OmittedFieldDefaultsTest {

    @Test
    fun `search content tolerates omitted empty collections`() {
        val response = FerrotuneJson.decodeFromString<FerrotuneSearchResponse>(
            """{"searchResult":{"artistTotal":0}}"""
        )

        assertTrue(response.searchResult.artist.isEmpty())
        assertTrue(response.searchResult.album.isEmpty())
        assertTrue(response.searchResult.song.isEmpty())
        assertEquals(0L, response.searchResult.artistTotal)
    }

    @Test
    fun `starred response tolerates omitted empty collections`() {
        val response = FerrotuneJson.decodeFromString<FerrotuneStarredResponse>("{}")

        assertTrue(response.artists.isEmpty())
        assertTrue(response.albums.isEmpty())
        assertTrue(response.songs.isEmpty())
    }

    @Test
    fun `tags response tolerates omitted additional blocks`() {
        val response = FerrotuneJson.decodeFromString<GetTagsResponse>(
            """
            {
                "id": "song-1",
                "filePath": "Artist/Album/01 Track.flac",
                "fileFormat": "flac",
                "editingEnabled": true,
                "tags": []
            }
            """.trimIndent()
        )

        assertTrue(response.additionalTags.isEmpty())
    }

    @Test
    fun `match result tolerates omitted from dictionary flag`() {
        val result = FerrotuneJson.decodeFromString<MatchResult>("""{"score":0.5}""")

        assertFalse(result.fromDictionary == true)
    }
}
