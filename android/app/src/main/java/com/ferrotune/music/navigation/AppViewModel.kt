package com.ferrotune.music.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.designsystem.theme.OklchColor
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.ConnectivityMonitor
import com.ferrotune.feature.settings.data.AccentSettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AppUiState(
    val isLoading: Boolean = true,
    val activeAccount: Account? = null,
    val accent: OklchColor? = null,
    val isOnline: Boolean = true,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val accountStore: AccountStore,
    private val accentSettingsRepository: AccentSettingsRepository,
    connectivityMonitor: ConnectivityMonitor,
) : ViewModel() {

    val uiState: StateFlow<AppUiState> = combine(
        accountStore.activeAccount,
        accentSettingsRepository.state,
        connectivityMonitor.isOnline,
    ) { account, accent, isOnline ->
        AppUiState(
            isLoading = false,
            activeAccount = account,
            accent = if (account != null) accent.color else null,
            isOnline = isOnline,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    init {
        viewModelScope.launch { runCatching { accentSettingsRepository.ensureLoaded() } }
    }

    fun signOutLocally() {
        accentSettingsRepository.invalidate()
        viewModelScope.launch { accountStore.setActive(null) }
    }
}
