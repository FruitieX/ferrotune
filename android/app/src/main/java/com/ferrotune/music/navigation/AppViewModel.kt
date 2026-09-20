package com.ferrotune.music.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.model.Account
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AppUiState(
    val isLoading: Boolean = true,
    val activeAccount: Account? = null,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val accountStore: AccountStore,
) : ViewModel() {

    val uiState: StateFlow<AppUiState> = accountStore.activeAccount
        .map { AppUiState(isLoading = false, activeAccount = it) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    fun signOutLocally() {
        viewModelScope.launch { accountStore.setActive(null) }
    }
}
