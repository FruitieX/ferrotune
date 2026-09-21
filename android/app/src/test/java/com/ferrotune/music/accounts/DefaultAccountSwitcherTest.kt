package com.ferrotune.music.accounts

import com.ferrotune.core.model.Account
import com.ferrotune.core.network.AccountApiFactory
import com.ferrotune.core.network.AccountScopedPreferences
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.network.dto.AuthSessionRefreshResponseDto
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DefaultAccountSwitcherTest {

    private val primary = account(id = "1@https://music.example.com", userId = 1L, label = "one")
    private val secondary = account(id = "2@https://music.example.com", userId = 2L, label = "two")

    @Test
    fun `switches account after refreshing its session`() = runTest {
        val accounts = FakeAccounts(listOf(primary, secondary), activeId = primary.id)
        val resetter = FakeResetter()
        val caches = listOf(FakeCache(), FakeCache())
        val api = FakeRefreshApi { AuthSessionRefreshResponseDto(sessionExpiresAt = "later") }
        val switcher = switcher(accounts, resetter, caches, api)

        val result = switcher.switchTo(secondary.id)

        assertEquals(AccountSwitchResult.Success, result)
        assertEquals(secondary.id, accounts.activeAccount.first()?.id)
        assertEquals("later", accounts.activeAccount.first()?.sessionExpiresAt)
        assertEquals(1, resetter.count)
        assertTrue(caches.all { it.invalidated })
        assertEquals(listOf("token-two"), api.refreshedTokens)
    }

    @Test
    fun `already active account is a no-op`() = runTest {
        val accounts = FakeAccounts(listOf(primary, secondary), activeId = primary.id)
        val resetter = FakeResetter()
        val caches = listOf(FakeCache())
        val api = FakeRefreshApi { AuthSessionRefreshResponseDto(sessionExpiresAt = "later") }
        val switcher = switcher(accounts, resetter, caches, api)

        val result = switcher.switchTo(primary.id)

        assertEquals(AccountSwitchResult.Success, result)
        assertEquals(0, resetter.count)
        assertEquals(false, caches.single().invalidated)
        assertEquals(emptyList<String>(), api.refreshedTokens)
    }

    @Test
    fun `unknown account fails without touching state`() = runTest {
        val accounts = FakeAccounts(listOf(primary), activeId = primary.id)
        val resetter = FakeResetter()
        val switcher = switcher(accounts, resetter, listOf(FakeCache()), FakeRefreshApi {
            AuthSessionRefreshResponseDto(sessionExpiresAt = "later")
        })

        val result = switcher.switchTo("missing")

        assertTrue(result is AccountSwitchResult.Failure)
        assertEquals(primary.id, accounts.activeAccount.first()?.id)
        assertEquals(0, resetter.count)
    }

    @Test
    fun `refresh failure keeps the current account`() = runTest {
        val accounts = FakeAccounts(listOf(primary, secondary), activeId = primary.id)
        val resetter = FakeResetter()
        val caches = listOf(FakeCache())
        val api = FakeRefreshApi { throw IOException("offline") }
        val switcher = switcher(accounts, resetter, caches, api)

        val result = switcher.switchTo(secondary.id)

        assertEquals(AccountSwitchResult.Failure("offline"), result)
        assertEquals(primary.id, accounts.activeAccount.first()?.id)
        assertEquals(0, resetter.count)
        assertEquals(false, caches.single().invalidated)
    }

    private fun switcher(
        accounts: FakeAccounts,
        resetter: FakeResetter,
        caches: List<FakeCache>,
        api: FakeRefreshApi,
    ) = DefaultAccountSwitcher(
        accounts = accounts,
        accountApiFactory = AccountApiFactory { serverUrl, token ->
            api.record(token)
            api
        },
        playbackSessionResetter = resetter,
        accountScopedPreferences = caches.toSet(),
    )

    private fun account(id: String, userId: Long, label: String) = Account(
        id = id,
        label = label,
        serverUrl = "https://music.example.com",
        username = label,
        userId = userId,
        sessionToken = "token-$label",
        sessionExpiresAt = "now",
    )

    private class FakeRefreshApi(
        private val onRefresh: () -> AuthSessionRefreshResponseDto,
    ) : FakeFerrotuneApi() {
        val refreshedTokens = mutableListOf<String>()

        fun record(token: String) {
            refreshedTokens.add(token)
        }

        override suspend fun refresh(): AuthSessionRefreshResponseDto = onRefresh()
    }

    private class FakeResetter : PlaybackSessionResetter {
        var count = 0

        override suspend fun resetSession() {
            count++
        }
    }

    private class FakeCache : AccountScopedPreferences {
        var invalidated = false

        override fun invalidate() {
            invalidated = true
        }
    }

}
