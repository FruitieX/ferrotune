package com.ferrotune.core.testing

import com.ferrotune.core.model.Account
import com.ferrotune.core.network.FerrotuneApi
import com.ferrotune.core.network.PreferencesCache
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.generated.PreferencesResponse
import kotlinx.coroutines.Dispatchers

/** In-memory [PreferencesCache] keyed by account id. */
class InMemoryPreferencesCache : PreferencesCache {
    val entries = mutableMapOf<String, PreferencesResponse>()

    override suspend fun read(accountId: String): PreferencesResponse? = entries[accountId]

    override suspend fun write(accountId: String, preferences: PreferencesResponse) {
        entries[accountId] = preferences
    }
}

/**
 * [ServerPreferences] over [api] whose background refreshes run eagerly on
 * the calling thread, so tests see their results without waiting.
 */
fun testServerPreferences(
    api: FerrotuneApi,
    cache: PreferencesCache = InMemoryPreferencesCache(),
    account: Account = testAccount(),
): ServerPreferences = ServerPreferences(FakeApiProvider(api, account), cache, Dispatchers.Unconfined)
