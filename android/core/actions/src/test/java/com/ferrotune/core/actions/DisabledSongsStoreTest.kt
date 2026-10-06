package com.ferrotune.core.actions

import com.ferrotune.core.network.FerrotuneApiException
import com.ferrotune.core.network.dto.SetDisabledRequest
import com.ferrotune.core.network.generated.BulkDisabledResponse
import com.ferrotune.core.network.generated.BulkSetDisabledRequest
import com.ferrotune.core.network.generated.DisabledSongsResponse
import com.ferrotune.core.network.generated.DisabledStatusResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DisabledSongsStoreTest {

    private class FakeDisabledApi : FakeFerrotuneApi() {
        var loads = 0
        var fail = false
        val singles = mutableListOf<Pair<String, Boolean>>()
        val bulks = mutableListOf<BulkSetDisabledRequest>()

        override suspend fun disabledSongs(): DisabledSongsResponse {
            loads++
            return DisabledSongsResponse(listOf("a", "b"))
        }

        override suspend fun setSongDisabled(id: String, request: SetDisabledRequest): DisabledStatusResponse {
            if (fail) throw FerrotuneApiException(500, "nope")
            singles += id to request.disabled
            return DisabledStatusResponse(id, request.disabled)
        }

        override suspend fun setSongsDisabled(request: BulkSetDisabledRequest): BulkDisabledResponse {
            if (fail) throw FerrotuneApiException(500, "nope")
            bulks += request
            return BulkDisabledResponse(request.songIds.size.toLong(), request.disabled)
        }
    }

    @Test
    fun `loads once per account and resets on account switch`() = runTest {
        val api = FakeDisabledApi()
        val store = DisabledSongsStore(FakeApiProvider(api))

        store.ensureLoaded()
        store.ensureLoaded()
        assertEquals(setOf("a", "b"), store.disabled.value)
        assertEquals(1, api.loads)

        store.invalidate()
        assertTrue(store.disabled.value.isEmpty())
        store.ensureLoaded()
        assertEquals(2, api.loads)
    }

    @Test
    fun `toggling applies immediately and is sent to the server`() = runTest {
        val api = FakeDisabledApi()
        val store = DisabledSongsStore(FakeApiProvider(api))
        store.ensureLoaded()

        store.setDisabled("c", true)
        store.setDisabled("a", false)
        store.setDisabled(listOf("d", "e"), true)

        assertEquals(setOf("b", "c", "d", "e"), store.disabled.value)
        assertEquals(listOf("c" to true, "a" to false), api.singles)
        assertEquals(listOf("d", "e"), api.bulks.single().songIds)
    }

    @Test
    fun `a refused change rolls back`() = runTest {
        val api = FakeDisabledApi()
        val store = DisabledSongsStore(FakeApiProvider(api))
        store.ensureLoaded()
        api.fail = true

        runCatching { store.setDisabled("a", false) }
        runCatching { store.setDisabled(listOf("x", "b"), false) }

        assertEquals(setOf("a", "b"), store.disabled.value)
    }
}
