package com.ferrotune.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.model.Account
import com.ferrotune.core.model.ServerUrl
import com.ferrotune.core.network.FerrotuneApiException
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.AuthLoginRequest
import com.ferrotune.core.network.dto.AuthLoginResponseDto
import com.ferrotune.core.network.generated.OidcExchangeRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val isConnecting: Boolean = false,
    val error: String? = null,
    val savedAccounts: List<Account> = emptyList(),
    val loggedInAccount: Account? = null,
    /** The entered server offers "Sign in with passkey" (OIDC). */
    val oidcAvailable: Boolean = false,
    /** Show the username/password form even though passkey sign-in is available. */
    val showPasswordForm: Boolean = false,
    /** Sign-in page for the screen to open in a Custom Tab, then report via [LoginViewModel.onOidcLaunched]. */
    val oidcLaunchUrl: String? = null,
    /** Servers of saved accounts (and the last used one) other than the entered one, to pick with a tap. */
    val serverSuggestions: List<String> = emptyList(),
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val apis: LoginApis,
    private val accountStore: Accounts,
    private val oidcRedirects: OidcRedirects,
    private val pendingOidc: PendingOidcLoginStore,
    private val lastServer: LastServerStore,
) : ViewModel() {

    private val form = MutableStateFlow(LoginUiState())

    val uiState: StateFlow<LoginUiState> = combine(form, accountStore.accounts) { state, saved ->
        state.copy(savedAccounts = saved, serverSuggestions = serverSuggestions(state.serverUrl, saved))
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LoginUiState())

    init {
        prefillServerUrl()
        probeOidcSupport()
        viewModelScope.launch {
            oidcRedirects.pending.filterNotNull().collect { uri ->
                oidcRedirects.consume(uri)
                completePasskeyLogin(uri)
            }
        }
    }

    /**
     * Starts on the last used server (else the most recent saved account's),
     * so after signing out the passkey button appears without typing a URL.
     */
    private fun prefillServerUrl() {
        viewModelScope.launch {
            val url = lastServer.get() ?: accountStore.accounts.first().firstOrNull()?.serverUrl
            if (url != null) {
                form.update { if (it.serverUrl.isEmpty()) it.copy(serverUrl = url) else it }
            }
        }
    }

    private fun serverSuggestions(entered: String, saved: List<Account>): List<String> {
        val current = entered.trim().takeIf { it.isNotEmpty() }?.let(ServerUrl::normalize)
        return (listOfNotNull(lastServer.get()) + saved.map { it.serverUrl })
            .distinct()
            .filter { it != current }
    }

    /** Asks the entered server whether it offers passkey sign-in, once typing pauses. */
    @OptIn(FlowPreview::class)
    private fun probeOidcSupport() {
        viewModelScope.launch {
            form.map { it.serverUrl.trim() }
                .distinctUntilChanged()
                .debounce(OIDC_PROBE_DEBOUNCE_MS)
                .collectLatest { raw ->
                    val enabled = raw.isNotEmpty() && try {
                        apis.create(ServerUrl.normalize(raw), null).oidcConfig().enabled
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        false
                    }
                    form.update { if (it.serverUrl.trim() == raw) it.copy(oidcAvailable = enabled) else it }
                }
        }
    }

    fun showPasswordForm() = form.update { it.copy(showPasswordForm = true) }

    /**
     * Starts passkey sign-in: the screen opens [LoginUiState.oidcLaunchUrl] in a Custom Tab.
     * With accounts already saved this may be "add account", so the provider is
     * asked to offer another account rather than reuse its session.
     */
    fun startPasskeyLogin() {
        val rawUrl = form.value.serverUrl.trim()
        if (rawUrl.isEmpty()) {
            form.update { it.copy(error = "Server URL is required") }
            return
        }
        val serverUrl = ServerUrl.normalize(rawUrl)
        viewModelScope.launch {
            val prompt = OidcLogin.promptFor(accountStore.accounts.first().size)
            val pkce = OidcLogin.newPkce()
            pendingOidc.save(PendingOidcLogin(serverUrl, pkce.verifier))
            form.update {
                it.copy(error = null, oidcLaunchUrl = OidcLogin.startUrl(serverUrl, pkce.challenge, prompt))
            }
        }
    }

    fun onOidcLaunched() = form.update { it.copy(oidcLaunchUrl = null) }

    fun onOidcLaunchFailed(message: String) =
        form.update { it.copy(oidcLaunchUrl = null, error = message) }

    private fun completePasskeyLogin(uri: String) {
        val pending = pendingOidc.take()
        val code = when (val redirect = OidcLogin.parseRedirect(uri)) {
            is OidcLogin.Redirect.Failure -> {
                form.update { it.copy(isConnecting = false, error = "Sign-in failed: ${redirect.message}") }
                return
            }
            is OidcLogin.Redirect.Code -> redirect.code
        }
        if (pending == null) {
            form.update { it.copy(error = "The sign-in expired. Please try again.") }
            return
        }

        form.update { it.copy(isConnecting = true, error = null, serverUrl = pending.serverUrl) }
        viewModelScope.launch {
            try {
                val api = apis.create(pending.serverUrl, null)
                val response = apiCall {
                    api.oidcExchange(
                        OidcExchangeRequest(
                            code = code,
                            codeVerifier = pending.verifier,
                            clientName = CLIENT_NAME,
                        ),
                    )
                }
                signedIn(pending.serverUrl, response)
            } catch (e: FerrotuneApiException) {
                form.update { it.copy(isConnecting = false, error = "Sign-in failed: ${e.message}") }
            } catch (e: Exception) {
                form.update { it.copy(isConnecting = false, error = e.message ?: "Unable to connect to server") }
            }
        }
    }

    private suspend fun signedIn(serverUrl: String, response: AuthLoginResponseDto) {
        val account = Account(
            id = Account.key(response.user.id, serverUrl),
            label = Account.displayLabel(response.user.username, serverUrl),
            serverUrl = serverUrl,
            username = response.user.username,
            userId = response.user.id,
            email = response.user.email,
            isAdmin = response.user.isAdmin,
            sessionToken = response.sessionToken,
            sessionExpiresAt = response.sessionExpiresAt,
        )
        accountStore.upsert(account)
        lastServer.save(serverUrl)
        form.update { it.copy(isConnecting = false, password = "", loggedInAccount = account) }
    }

    fun onServerUrlChange(value: String) = form.update { it.copy(serverUrl = value, error = null) }

    fun onUsernameChange(value: String) = form.update { it.copy(username = value, error = null) }

    fun onPasswordChange(value: String) = form.update { it.copy(password = value, error = null) }

    fun login() {
        val state = form.value
        val rawUrl = state.serverUrl.trim()
        val username = state.username.trim()
        val password = state.password

        if (rawUrl.isEmpty()) {
            form.update { it.copy(error = "Server URL is required") }
            return
        }
        if (username.isEmpty() || password.isEmpty()) {
            form.update { it.copy(error = "Username and password are required") }
            return
        }

        val serverUrl = ServerUrl.normalize(rawUrl)
        form.update { it.copy(isConnecting = true, error = null) }

        viewModelScope.launch {
            try {
                val anonymousApi = apis.create(serverUrl, null)
                val response = apiCall {
                    anonymousApi.login(AuthLoginRequest(username = username, password = password))
                }

                signedIn(serverUrl, response)
            } catch (e: FerrotuneApiException) {
                form.update {
                    it.copy(
                        isConnecting = false,
                        error = if (e.statusCode == 401) "Authentication failed: ${e.message}" else e.message,
                    )
                }
            } catch (e: Exception) {
                form.update { it.copy(isConnecting = false, error = e.message ?: "Unable to connect to server") }
            }
        }
    }

    fun loginWithSavedAccount(account: Account) {
        form.update { it.copy(isConnecting = true, error = null) }

        viewModelScope.launch {
            try {
                val api = apis.create(account.serverUrl, account.sessionToken)
                val refreshed = apiCall { api.refresh() }
                val updated = account.copy(sessionExpiresAt = refreshed.sessionExpiresAt)
                accountStore.upsert(updated)
                lastServer.save(updated.serverUrl)
                form.update { it.copy(isConnecting = false, loggedInAccount = updated) }
            } catch (e: FerrotuneApiException) {
                if (e.statusCode == 401) {
                    // The server no longer accepts this session: forget it and
                    // prefill the form so signing in again only needs the password.
                    accountStore.remove(account.id)
                    form.update {
                        it.copy(
                            isConnecting = false,
                            serverUrl = account.serverUrl,
                            username = account.username,
                            password = "",
                            error = "The session for ${account.label} has expired. Sign in again to continue.",
                        )
                    }
                } else {
                    form.update { it.copy(isConnecting = false, error = e.message) }
                }
            } catch (e: Exception) {
                form.update { it.copy(isConnecting = false, error = e.message ?: "Unable to connect to server") }
            }
        }
    }

    fun removeSavedAccount(account: Account) {
        viewModelScope.launch { accountStore.remove(account.id) }
    }

    private companion object {
        const val OIDC_PROBE_DEBOUNCE_MS = 400L
        const val CLIENT_NAME = "ferrotune-mobile"
    }
}
