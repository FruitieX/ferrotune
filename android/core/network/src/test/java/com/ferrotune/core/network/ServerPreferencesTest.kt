package com.ferrotune.core.network

import com.ferrotune.core.model.Account
import com.ferrotune.core.network.generated.GetPreferenceResponse
import com.ferrotune.core.network.generated.PreferencesResponse
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.network.generated.UpdatePreferencesRequest
import com.ferrotune.core.testing.FakePreferencesApi
import com.ferrotune.core.testing.InMemoryPreferencesCache
import com.ferrotune.core.testing.testAccount
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ServerPreferencesTest {

    private class CountingApi : FakePreferencesApi() {
        var reads = 0
        var failReads = false
        var failWrites = false
        var gate: CompletableDeferred<Unit>? = null
        var accent = "rust"

        override suspend fun preferences(): PreferencesResponse {
            reads++
            gate?.await()
            if (failReads) throw FerrotuneApiException(503, "offline")
            return super.preferences().copy(accentColor = accent)
        }

        override suspend fun setPreference(
            key: String,
            request: SetPreferenceRequest,
        ): GetPreferenceResponse {
            if (failWrites) throw FerrotuneApiException(503, "offline")
            return super.setPreference(key, request)
        }

        override suspend fun updatePreferences(request: UpdatePreferencesRequest): PreferencesResponse {
            if (failWrites) throw FerrotuneApiException(503, "offline")
            accent = request.accentColor
            return PreferencesResponse(
                accentColor = request.accentColor,
                customAccentHue = request.customAccentHue,
                customAccentLightness = request.customAccentLightness,
                customAccentChroma = request.customAccentChroma,
                preferences = preferenceValues.toMap(),
            )
        }
    }

    private class SwitchableProvider(val api: FerrotuneApi, var account: Account) : FerrotuneApiProvider {
        override suspend fun requireApi(): FerrotuneApi = api
        override suspend fun requireAccount(): Account = account
    }

    private val account = testAccount()
    private val otherAccount = account.copy(id = "other")

    private fun preferences(
        api: CountingApi,
        cache: InMemoryPreferencesCache = InMemoryPreferencesCache(),
        provider: SwitchableProvider = SwitchableProvider(api, account),
    ) = ServerPreferences(provider, cache, Dispatchers.Unconfined)

    private fun cached(vararg values: Pair<String, String>) = PreferencesResponse(
        accentColor = "blue",
        preferences = values.associate { (key, value) -> key to JsonPrimitive(value) },
    )

    @Test
    fun `ensureLoaded reads the server once and caches the result on device`() = runTest {
        val api = CountingApi().apply { preferenceValues["key"] = JsonPrimitive("server") }
        val cache = InMemoryPreferencesCache()
        val preferences = preferences(api, cache)

        preferences.ensureLoaded()
        preferences.ensureLoaded()

        assertEquals(1, api.reads)
        assertEquals(JsonPrimitive("server"), preferences.snapshot.value.preferences["key"])
        assertEquals(JsonPrimitive("server"), cache.entries[account.id]?.preferences?.get("key"))
    }

    @Test
    fun `cached values show immediately while the server refresh is in flight`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = CountingApi().apply {
            preferenceValues["key"] = JsonPrimitive("server")
            this.gate = gate
        }
        val cache = InMemoryPreferencesCache().apply { entries[account.id] = cached("key" to "disk") }
        val preferences = preferences(api, cache)

        preferences.ensureLoaded()
        assertEquals(JsonPrimitive("disk"), preferences.snapshot.value.preferences["key"])
        assertEquals("blue", preferences.snapshot.value.accentColor)

        gate.complete(Unit)
        assertEquals(JsonPrimitive("server"), preferences.snapshot.value.preferences["key"])
        assertEquals(JsonPrimitive("server"), cache.entries[account.id]?.preferences?.get("key"))
    }

    @Test
    fun `a cold offline start with a cache keeps the cached values`() = runTest {
        val api = CountingApi().apply { failReads = true }
        val cache = InMemoryPreferencesCache().apply { entries[account.id] = cached("key" to "disk") }
        val preferences = preferences(api, cache)

        preferences.ensureLoaded()

        assertEquals(JsonPrimitive("disk"), preferences.snapshot.value.preferences["key"])
    }

    @Test
    fun `without a cache a failed read throws and the next call retries`() = runTest {
        val api = CountingApi().apply { failReads = true }
        val preferences = preferences(api)

        try {
            preferences.ensureLoaded()
            fail("expected the server failure to propagate")
        } catch (e: FerrotuneApiException) {
            assertEquals(503, e.statusCode)
        }

        api.failReads = false
        api.preferenceValues["key"] = JsonPrimitive("server")
        preferences.ensureLoaded()

        assertEquals(2, api.reads)
        assertEquals(JsonPrimitive("server"), preferences.snapshot.value.preferences["key"])
    }

    @Test
    fun `invalidate and max age trigger a fresh read`() = runTest {
        val api = CountingApi()
        val preferences = preferences(api)
        preferences.ensureLoaded()

        preferences.invalidate()
        preferences.ensureLoaded()
        assertEquals(2, api.reads)

        preferences.ensureLoaded(maxAgeMs = Long.MAX_VALUE)
        assertEquals(2, api.reads)

        preferences.ensureLoaded(maxAgeMs = -1)
        assertEquals(3, api.reads)
    }

    @Test
    fun `switching accounts swaps to that account's cache and refreshes it`() = runTest {
        val api = CountingApi().apply { failReads = true }
        val cache = InMemoryPreferencesCache().apply {
            entries[account.id] = cached("key" to "first")
            entries[otherAccount.id] = cached("key" to "second")
        }
        val provider = SwitchableProvider(api, account)
        val preferences = preferences(api, cache, provider)
        preferences.ensureLoaded()
        assertEquals(JsonPrimitive("first"), preferences.snapshot.value.preferences["key"])

        provider.account = otherAccount
        preferences.ensureLoaded()

        assertEquals(JsonPrimitive("second"), preferences.snapshot.value.preferences["key"])
        assertEquals(2, api.reads)
    }

    @Test
    fun `set applies optimistically and persists to the server and cache`() = runTest {
        val api = CountingApi()
        val cache = InMemoryPreferencesCache()
        val preferences = preferences(api, cache)
        preferences.ensureLoaded()

        preferences.set("key", JsonPrimitive("new"))

        assertEquals(JsonPrimitive("new"), preferences.snapshot.value.preferences["key"])
        assertEquals(JsonPrimitive("new"), api.preferenceValues["key"])
        assertEquals(JsonPrimitive("new"), cache.entries[account.id]?.preferences?.get("key"))
    }

    @Test
    fun `a rejected write rolls back`() = runTest {
        val api = CountingApi().apply { preferenceValues["key"] = JsonPrimitive("old") }
        val preferences = preferences(api)
        preferences.ensureLoaded()
        api.failWrites = true

        runCatching { preferences.set("key", JsonPrimitive("new")) }
        runCatching { preferences.set("added", JsonPrimitive("new")) }
        runCatching { preferences.setAccent("green", 1.0, 0.5, 0.1) }

        assertEquals(JsonPrimitive("old"), preferences.snapshot.value.preferences["key"])
        assertNull(preferences.snapshot.value.preferences["added"])
        assertEquals("rust", preferences.snapshot.value.accentColor)
    }

    @Test
    fun `setAccent stores the server's response`() = runTest {
        val api = CountingApi()
        val cache = InMemoryPreferencesCache()
        val preferences = preferences(api, cache)
        preferences.ensureLoaded()

        preferences.setAccent("custom", hue = 120.0, lightness = 0.6, chroma = 0.2)

        val snapshot = preferences.snapshot.value
        assertEquals("custom", snapshot.accentColor)
        assertEquals(120.0, snapshot.customAccentHue!!, 0.0)
        assertTrue(cache.entries[account.id]?.accentColor == "custom")
    }

    @Test
    fun `mapState derives synchronously and reuses results for unchanged input`() {
        val source = kotlinx.coroutines.flow.MutableStateFlow(1)
        var calls = 0
        val derived = source.mapState { calls++; it * 10 }

        assertEquals(10, derived.value)
        assertEquals(10, derived.value)
        assertEquals(1, calls)

        source.value = 2
        assertEquals(20, derived.value)
    }
}
