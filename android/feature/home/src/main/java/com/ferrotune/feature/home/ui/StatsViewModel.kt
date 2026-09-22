package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.StatsResponse
import com.ferrotune.feature.home.data.HomeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StatsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val stats: StatsResponse? = null,
    val listening: ListeningStatsResponse? = null,
)

@HiltViewModel
class StatsViewModel @Inject constructor(
    private val repository: HomeRepository,
) : ViewModel() {

    private val state = MutableStateFlow(StatsUiState())
    val uiState: StateFlow<StatsUiState> = state.asStateFlow()

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val stats = repository.stats()
                val listening = repository.listeningStats()
                state.update { it.copy(loading = false, stats = stats, listening = listening) }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load stats")
                }
            }
        }
    }
}
