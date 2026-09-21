package com.ferrotune.music.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.ConnectivityMonitor
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.feature.settings.data.AccentSettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class AppUiState(
    val isLoading: Boolean = true,
    val activeAccount: Account? = null,
    val accounts: List<Account> = emptyList(),
    val accent: OklchColor? = null,
    val isOnline: Boolean = true,
    val switchError: String? = null,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val accounts: Accounts,
    private val accentSettingsRepository: AccentSettingsRepository,
    private val accountSwitcher: AccountSwitcher,
    private val playbackSessionResetter: PlaybackSessionResetter,
    connectivityMonitor: ConnectivityMonitor,
) : ViewModel() {

    private val switchError = MutableStateFlow<String?>(null)

    val uiState: StateFlow<AppUiState> = combine(
        accounts.activeAccount,
        accounts.accounts,
        accentSettingsRepository.state,
        connectivityMonitor.isOnline,
        switchError,
    ) { account, savedAccounts, accent, isOnline, error ->
        AppUiState(
            isLoading = false,
            activeAccount = account,
            accounts = savedAccounts,
            accent = if (account != null) accent.color else null,
            isOnline = isOnline,
            switchError = error,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    init {
        viewModelScope.launch {
            accounts.activeAccount
                .map { it?.id }
                .distinctUntilChanged()
                .collect {
                    accentSettingsRepository.invalidate()
                    runCatching { accentSettingsRepository.ensureLoaded() }
                }
        }
    }

    fun switchAccount(accountId: String) {
        viewModelScope.launch {
            when (val result = accountSwitcher.switchTo(accountId)) {
                is AccountSwitchResult.Failure -> switchError.value = result.message
                AccountSwitchResult.Success -> Unit
            }
        }
    }

    fun dismissSwitchError() {
        switchError.value = null
    }

    fun signOutLocally() {
        viewModelScope.launch {
            runCatching { playbackSessionResetter.resetSession() }
            accounts.setActive(null)
        }
    }
}
