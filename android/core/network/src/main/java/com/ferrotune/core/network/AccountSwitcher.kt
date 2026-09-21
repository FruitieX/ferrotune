package com.ferrotune.core.network

/**
 * Switches the active account without signing out: refreshes the target
 * account's session token, activates it, and drops account-scoped caches.
 * Implemented in the app module, where all account-scoped state is visible.
 */
interface AccountSwitcher {
    suspend fun switchTo(accountId: String): AccountSwitchResult
}

sealed interface AccountSwitchResult {
    data object Success : AccountSwitchResult
    data class Failure(val message: String) : AccountSwitchResult
}

/**
 * Server-synced preference cache that must be dropped when the active account
 * changes. Implemented by every preference repository.
 */
interface AccountScopedPreferences {
    fun invalidate()
}

/** Creates an API client bound to one account's server and session token. */
fun interface AccountApiFactory {
    fun create(serverUrl: String, sessionToken: String): FerrotuneApi
}

/** Stops playback and drops the current server playback session. */
fun interface PlaybackSessionResetter {
    suspend fun resetSession()
}
