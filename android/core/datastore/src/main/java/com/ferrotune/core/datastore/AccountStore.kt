package com.ferrotune.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ferrotune.core.model.Account
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private val Context.accountDataStore: DataStore<Preferences> by preferencesDataStore(name = "ferrotune_accounts")

/**
 * Device-level store of saved accounts and the currently active account.
 * The account list is serialized to JSON and encrypted before persistence.
 */
@Singleton
class AccountStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : Accounts {
    private val json = Json { ignoreUnknownKeys = true }

    override val accounts: Flow<List<Account>> = context.accountDataStore.data.map { preferences ->
        preferences[ACCOUNTS_KEY]?.let(::decodeAccounts) ?: emptyList()
    }

    override val activeAccountId: Flow<String?> =
        context.accountDataStore.data.map { it[ACTIVE_KEY] }

    override val activeAccount: Flow<Account?> =
        combine(accounts, activeAccountId) { accounts, activeId ->
            accounts.firstOrNull { it.id == activeId }
        }

    override suspend fun upsert(account: Account) {
        context.accountDataStore.edit { preferences ->
            val current = preferences[ACCOUNTS_KEY]?.let(::decodeAccounts) ?: emptyList()
            val updated = listOf(account) + current.filterNot { it.id == account.id }
            preferences[ACCOUNTS_KEY] = encodeAccounts(updated)
            preferences[ACTIVE_KEY] = account.id
        }
    }

    override suspend fun setActive(accountId: String?) {
        context.accountDataStore.edit { preferences ->
            if (accountId == null) {
                preferences.remove(ACTIVE_KEY)
            } else {
                preferences[ACTIVE_KEY] = accountId
            }
        }
    }

    override suspend fun remove(accountId: String) {
        context.accountDataStore.edit { preferences ->
            val current = preferences[ACCOUNTS_KEY]?.let(::decodeAccounts) ?: emptyList()
            preferences[ACCOUNTS_KEY] = encodeAccounts(current.filterNot { it.id == accountId })
            if (preferences[ACTIVE_KEY] == accountId) {
                preferences.remove(ACTIVE_KEY)
            }
        }
    }

    /**
     * Stable per-install client id used to identify this device in playback
     * sessions. Generated on first access.
     */
    suspend fun clientId(): String {
        var value: String? = null
        context.accountDataStore.edit { preferences ->
            val existing = preferences[CLIENT_ID_KEY]
            if (existing != null) {
                value = existing
            } else {
                val generated = UUID.randomUUID().toString()
                preferences[CLIENT_ID_KEY] = generated
                value = generated
            }
        }
        return checkNotNull(value) { "client id unavailable" }
    }

    private fun decodeAccounts(stored: String): List<Account> = runCatching {
        json.decodeFromString(ListSerializer(Account.serializer()), TokenCipher.decrypt(stored))
    }.getOrDefault(emptyList())

    private fun encodeAccounts(accounts: List<Account>): String =
        TokenCipher.encrypt(json.encodeToString(ListSerializer(Account.serializer()), accounts))

    private companion object {
        val ACCOUNTS_KEY = stringPreferencesKey("accounts")
        val ACTIVE_KEY = stringPreferencesKey("active_account_id")
        val CLIENT_ID_KEY = stringPreferencesKey("client_id")
    }
}
