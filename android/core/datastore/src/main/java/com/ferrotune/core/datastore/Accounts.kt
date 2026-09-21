package com.ferrotune.core.datastore

import com.ferrotune.core.model.Account
import kotlinx.coroutines.flow.Flow

/**
 * Saved accounts and the active account selection. Implemented by
 * [AccountStore]; the interface exists so account switching can be unit
 * tested without Android DataStore.
 */
interface Accounts {
    val accounts: Flow<List<Account>>
    val activeAccountId: Flow<String?>
    val activeAccount: Flow<Account?>

    suspend fun upsert(account: Account)
    suspend fun setActive(accountId: String?)
    suspend fun remove(accountId: String)
}
