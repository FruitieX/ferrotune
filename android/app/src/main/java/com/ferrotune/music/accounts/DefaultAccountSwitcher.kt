package com.ferrotune.music.accounts

import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.network.AccountApiFactory
import com.ferrotune.core.network.AccountScopedPreferences
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * Refreshes the target account's session token, makes it active, resets the
 * playback session, and drops every account-scoped preference cache. The web
 * client does the same sequence on account switch.
 */
@Singleton
class DefaultAccountSwitcher @Inject constructor(
    private val accounts: Accounts,
    private val accountApiFactory: AccountApiFactory,
    private val playbackSessionResetter: PlaybackSessionResetter,
    private val accountScopedPreferences: Set<@JvmSuppressWildcards AccountScopedPreferences>,
) : AccountSwitcher {

    override suspend fun switchTo(accountId: String): AccountSwitchResult {
        val account = accounts.accounts.first().firstOrNull { it.id == accountId }
            ?: return AccountSwitchResult.Failure("Account not found")
        if (accounts.activeAccount.first()?.id == accountId) {
            return AccountSwitchResult.Success
        }

        val refreshed = try {
            apiCall {
                accountApiFactory.create(account.serverUrl, account.sessionToken).refresh()
            }
        } catch (e: Exception) {
            return AccountSwitchResult.Failure(
                e.message ?: "Could not sign in to ${account.label}",
            )
        }

        playbackSessionResetter.resetSession()
        accounts.upsert(account.copy(sessionExpiresAt = refreshed.sessionExpiresAt))
        accountScopedPreferences.forEach { it.invalidate() }
        return AccountSwitchResult.Success
    }
}
