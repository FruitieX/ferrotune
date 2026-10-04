package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.UserInfo
import com.ferrotune.core.network.readableMessage
import com.ferrotune.feature.home.data.HomeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Web profile page: account details and listening activity. Each card loads
 * on its own, so one failing request doesn't blank the whole page.
 */
data class ProfileUiState(
    val user: UserInfo? = null,
    val userLoading: Boolean = true,
    val listening: ListeningStatsResponse? = null,
    val listeningLoading: Boolean = true,
    val listeningError: String? = null,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repository: HomeRepository,
) : ViewModel() {

    private val state = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = state.asStateFlow()

    init {
        load()
    }

    fun load() {
        state.update { it.copy(userLoading = true, listeningLoading = true, listeningError = null) }
        viewModelScope.launch {
            val user = runCatching { repository.currentUser() }.getOrNull()
            state.update { it.copy(user = user ?: it.user, userLoading = false) }
        }
        viewModelScope.launch {
            runCatching { repository.listeningStats() }
                .onSuccess { listening -> state.update { it.copy(listening = listening, listeningLoading = false) } }
                .onFailure { e ->
                    state.update {
                        it.copy(listeningLoading = false, listeningError = e.readableMessage() ?: "Couldn't load listening activity")
                    }
                }
        }
    }
}

/** Web "Skip Rate": skips per listening session, rounded to a whole percent. */
internal fun skipRatePercent(skips: Long, sessions: Long): Int =
    if (sessions <= 0) 0 else Math.round(skips * 100.0 / sessions).toInt()
