package com.ferrotune.core.network

import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.model.Account
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Supplies a [FerrotuneApi] bound to the active account's server and token.
 * The Retrofit instance is cached until the account or token changes.
 */
@Singleton
class AuthenticatedApiProvider @Inject constructor(
    private val apiFactory: FerrotuneApiFactory,
    private val accountStore: AccountStore,
) : FerrotuneApiProvider {
    private val mutex = Mutex()
    private var cached: CachedApi? = null

    private data class CachedApi(
        val serverUrl: String,
        val sessionToken: String,
        val api: FerrotuneApi,
    )

    override suspend fun requireAccount(): Account =
        accountStore.activeAccount.first()
            ?: throw FerrotuneApiException(401, "Not signed in")

    override suspend fun requireApi(): FerrotuneApi {
        val account = requireAccount()
        return mutex.withLock {
            val current = cached
            if (
                current != null &&
                current.serverUrl == account.serverUrl &&
                current.sessionToken == account.sessionToken
            ) {
                return current.api
            }
            val api = apiFactory.create(account.serverUrl) { account.sessionToken }
            cached = CachedApi(account.serverUrl, account.sessionToken, api)
            api
        }
    }
}
