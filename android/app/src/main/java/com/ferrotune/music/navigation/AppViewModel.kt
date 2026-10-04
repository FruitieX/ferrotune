package com.ferrotune.music.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessage
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.datastore.ThemePreferencesRepository
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.model.Account
import com.ferrotune.core.model.ThemeMode
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.ConnectivityMonitor
import com.ferrotune.core.network.PlaybackSessionResetter
import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.feature.settings.data.AccentSettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
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
    val themeMode: ThemeMode = ThemeMode.DEFAULT,
    val switchError: String? = null,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val accounts: Accounts,
    private val accentSettingsRepository: AccentSettingsRepository,
    private val accountSwitcher: AccountSwitcher,
    private val playbackSessionResetter: PlaybackSessionResetter,
    private val playbackStarter: PlaybackStarter,
    private val serverPreferences: ServerPreferences,
    userMessages: UserMessages,
    themePreferencesRepository: ThemePreferencesRepository,
    connectivityMonitor: ConnectivityMonitor,
) : ViewModel() {

    private val switchError = MutableStateFlow<String?>(null)

    /** Confirmations and errors from actions anywhere in the app. */
    val messages: SharedFlow<UserMessage> = userMessages.messages

    val uiState: StateFlow<AppUiState> = combine(
        combine(
            accounts.activeAccount,
            accounts.accounts,
            accentSettingsRepository.state,
            themePreferencesRepository.themeMode,
            switchError,
        ) { account, savedAccounts, accent, themeMode, error ->
            AppUiState(
                isLoading = false,
                activeAccount = account,
                accounts = savedAccounts,
                accent = if (account != null) accent.color else null,
                themeMode = themeMode,
                switchError = error,
            )
        },
        connectivityMonitor.isOnline,
    ) { state, isOnline -> state.copy(isOnline = isOnline) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    init {
        viewModelScope.launch {
            accounts.activeAccount
                .map { it?.id }
                .distinctUntilChanged()
                .collect { accountId ->
                    if (accountId != null) {
                        restorePlaybackSession()
                        runCatching { serverPreferences.ensureLoaded() }
                    }
                }
        }
    }

    /** Reattaches to the server playback session when the app returns to the foreground. */
    fun onForeground() {
        if (uiState.value.activeAccount == null) return
        restorePlaybackSession()
        // Pick up preference changes made on other devices while backgrounded.
        viewModelScope.launch {
            runCatching { serverPreferences.ensureLoaded(maxAgeMs = FOREGROUND_PREFERENCES_MAX_AGE_MS) }
        }
    }

    private fun restorePlaybackSession() {
        viewModelScope.launch { runCatching { playbackStarter.restoreSession() } }
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

/** Preferences read longer ago than this are refreshed when the app returns to the foreground. */
private const val FOREGROUND_PREFERENCES_MAX_AGE_MS = 60_000L
