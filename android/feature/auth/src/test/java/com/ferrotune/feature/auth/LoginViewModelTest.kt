package com.ferrotune.feature.auth

import com.ferrotune.core.model.Account
import com.ferrotune.core.network.generated.OidcConfigResponse
import com.ferrotune.core.testing.FakeAccounts
import com.ferrotune.core.testing.FakeFerrotuneApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class InMemoryLastServer(var value: String? = null) : LastServerStore {
        override fun get() = value
        override fun save(serverUrl: String) {
            value = serverUrl
        }
    }

    private class InMemoryPending : PendingOidcLoginStore {
        var saved: PendingOidcLogin? = null
        override fun save(login: PendingOidcLogin) {
            saved = login
        }
        override fun take(): PendingOidcLogin? = saved.also { saved = null }
    }

    /** Servers that offer passkey sign-in; records every probe. */
    private class OidcServers(private val enabled: Set<String>) : LoginApis {
        val probed = mutableListOf<String>()
        override fun create(serverUrl: String, sessionToken: String?) = object : FakeFerrotuneApi() {
            override suspend fun oidcConfig(): OidcConfigResponse {
                probed += serverUrl
                return OidcConfigResponse(enabled = serverUrl in enabled)
            }
        }
    }

    private fun account(name: String, id: Long, server: String) = Account(
        id = Account.key(id, server),
        label = Account.displayLabel(name, server),
        serverUrl = server,
        username = name,
        userId = id,
        sessionToken = "token-$name",
        sessionExpiresAt = "2027-01-01T00:00:00Z",
    )

    private fun TestScope.viewModel(
        accounts: List<Account> = emptyList(),
        lastServer: String? = null,
        servers: OidcServers = OidcServers(setOf(MUSIC, OTHER)),
        pending: InMemoryPending = InMemoryPending(),
    ): LoginViewModel {
        val vm = LoginViewModel(
            apis = servers,
            accountStore = FakeAccounts(accounts),
            oidcRedirects = OidcRedirects(),
            pendingOidc = pending,
            lastServer = InMemoryLastServer(lastServer),
        )
        // Keep the WhileSubscribed state alive like the screen does.
        vm.uiState.launchIn(backgroundScope)
        return vm
    }

    @Test
    fun `after sign-out the passkey button appears for the saved account's server`() = runTest(dispatcher) {
        // Signing out keeps the account but leaves no active one.
        val servers = OidcServers(setOf(MUSIC))
        val vm = viewModel(accounts = listOf(account("rasse", 1, MUSIC)), servers = servers)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(MUSIC, state.serverUrl)
        assertTrue(state.oidcAvailable)
        assertEquals(listOf(MUSIC), servers.probed)
    }

    @Test
    fun `the last used server wins over older saved accounts`() = runTest(dispatcher) {
        val vm = viewModel(
            accounts = listOf(account("rasse", 1, OTHER)),
            lastServer = MUSIC,
        )
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(MUSIC, state.serverUrl)
        assertTrue(state.oidcAvailable)
        // Other known servers are a tap away.
        assertEquals(listOf(OTHER), state.serverSuggestions)
        vm.onServerUrlChange(OTHER)
        advanceUntilIdle()
        assertEquals(OTHER, vm.uiState.value.serverUrl)
        assertEquals(listOf(MUSIC), vm.uiState.value.serverSuggestions)
    }

    @Test
    fun `a fresh install starts empty without probing`() = runTest(dispatcher) {
        val servers = OidcServers(setOf(MUSIC))
        val vm = viewModel(servers = servers)
        advanceUntilIdle()

        assertEquals("", vm.uiState.value.serverUrl)
        assertFalse(vm.uiState.value.oidcAvailable)
        assertTrue(servers.probed.isEmpty())
    }

    @Test
    fun `a first passkey sign-in sends no prompt`() = runTest(dispatcher) {
        val pending = InMemoryPending()
        val vm = viewModel(lastServer = MUSIC, pending = pending)
        advanceUntilIdle()

        vm.startPasskeyLogin()
        advanceUntilIdle()

        val url = checkNotNull(vm.uiState.value.oidcLaunchUrl)
        assertFalse(url, url.contains("prompt="))
        assertEquals(MUSIC, pending.saved?.serverUrl)
    }

    @Test
    fun `adding an account asks the provider to offer another account`() = runTest(dispatcher) {
        val vm = viewModel(accounts = listOf(account("rasse", 1, MUSIC)))
        advanceUntilIdle()

        vm.startPasskeyLogin()
        advanceUntilIdle()

        val url = checkNotNull(vm.uiState.value.oidcLaunchUrl)
        assertTrue(url, url.endsWith("&prompt=select_account"))
    }

    private companion object {
        const val MUSIC = "https://music.example.org"
        const val OTHER = "http://192.168.1.10:4040"
    }
}
