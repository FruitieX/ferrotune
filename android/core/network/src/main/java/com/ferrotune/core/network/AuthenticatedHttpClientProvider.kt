package com.ferrotune.core.network

import android.content.Context
import com.ferrotune.core.datastore.AccountStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Process-wide OkHttp client that attaches the active account's bearer token
 * to every request. Used by the Coil image loader so cover art loads without
 * per-request header plumbing.
 */
@Singleton
class AuthenticatedHttpClientProvider @Inject constructor(
    @ApplicationContext context: Context,
    accountStore: AccountStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Volatile
    private var token: String? = null

    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            chain.proceed(chain.request().withBearerToken(token))
        }
        .build()

    init {
        scope.launch {
            accountStore.activeAccount.collect { account ->
                token = account?.sessionToken
            }
        }
    }
}

internal fun Request.withBearerToken(token: String?): Request =
    if (token.isNullOrBlank()) {
        this
    } else {
        newBuilder().header("Authorization", "Bearer $token").build()
    }
