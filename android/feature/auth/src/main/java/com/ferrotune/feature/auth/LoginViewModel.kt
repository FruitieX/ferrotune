package com.ferrotune.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.model.Account
import com.ferrotune.core.model.ServerUrl
import com.ferrotune.core.network.FerrotuneApiException
import com.ferrotune.core.network.FerrotuneApiFactory
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.AuthLoginRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
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
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val apiFactory: FerrotuneApiFactory,
    private val accountStore: AccountStore,
) : ViewModel() {

    private val form = MutableStateFlow(LoginUiState())

    val uiState: StateFlow<LoginUiState> = combine(form, accountStore.accounts) { state, saved ->
        state.copy(savedAccounts = saved)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LoginUiState())

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
                val anonymousApi = apiFactory.create(serverUrl)
                val response = apiCall {
                    anonymousApi.login(AuthLoginRequest(username = username, password = password))
                }

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
                form.update { it.copy(isConnecting = false, password = "", loggedInAccount = account) }
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
                val api = apiFactory.create(account.serverUrl) { account.sessionToken }
                val refreshed = apiCall { api.refresh() }
                val updated = account.copy(sessionExpiresAt = refreshed.sessionExpiresAt)
                accountStore.upsert(updated)
                form.update { it.copy(isConnecting = false, loggedInAccount = updated) }
            } catch (e: FerrotuneApiException) {
                form.update {
                    it.copy(isConnecting = false, error = "Saved session expired: ${e.message}")
                }
            } catch (e: Exception) {
                form.update { it.copy(isConnecting = false, error = e.message ?: "Unable to connect to server") }
            }
        }
    }

    fun removeSavedAccount(account: Account) {
        viewModelScope.launch { accountStore.remove(account.id) }
    }
}
