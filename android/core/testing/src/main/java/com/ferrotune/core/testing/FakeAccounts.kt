package com.ferrotune.core.testing

import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.AccountSwitcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** In-memory [Accounts] for tests. */
class FakeAccounts(
    initial: List<Account> = emptyList(),
    activeId: String? = null,
) : Accounts {
    private val _accounts = MutableStateFlow(initial)
    private val _activeId = MutableStateFlow(activeId)
    private val _activeAccount = MutableStateFlow(initial.firstOrNull { it.id == activeId })

    override val accounts: StateFlow<List<Account>> = _accounts
    override val activeAccountId: StateFlow<String?> = _activeId
    override val activeAccount: StateFlow<Account?> = _activeAccount

    override suspend fun upsert(account: Account) {
        _accounts.value = listOf(account) + _accounts.value.filterNot { it.id == account.id }
        _activeId.value = account.id
        _activeAccount.value = account
    }

    override suspend fun setActive(accountId: String?) {
        _activeId.value = accountId
        _activeAccount.value = _accounts.value.firstOrNull { it.id == accountId }
    }

    override suspend fun remove(accountId: String) {
        _accounts.value = _accounts.value.filterNot { it.id == accountId }
        if (_activeId.value == accountId) {
            _activeId.value = null
            _activeAccount.value = null
        }
    }
}

/** Records account switch requests; returns [result]. */
class FakeAccountSwitcher(
    var result: AccountSwitchResult = AccountSwitchResult.Success,
) : AccountSwitcher {
    val switchedTo = mutableListOf<String>()

    override suspend fun switchTo(accountId: String): AccountSwitchResult {
        switchedTo.add(accountId)
        return result
    }
}
