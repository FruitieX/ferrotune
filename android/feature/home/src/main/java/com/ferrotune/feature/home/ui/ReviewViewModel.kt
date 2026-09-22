package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.network.generated.AvailablePeriod
import com.ferrotune.core.network.generated.PeriodReview
import com.ferrotune.feature.home.data.HomeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ReviewUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val review: PeriodReview? = null,
    val periods: List<AvailablePeriod> = emptyList(),
    val selectedYear: Int? = null,
    val selectedMonth: Int? = null,
    val serverUrl: String? = null,
)

@HiltViewModel
class ReviewViewModel @Inject constructor(
    private val repository: HomeRepository,
) : ViewModel() {

    private val state = MutableStateFlow(ReviewUiState())
    val uiState: StateFlow<ReviewUiState> = state.asStateFlow()

    init {
        load(year = null, month = null)
    }

    fun load(year: Int? = null, month: Int? = null) {
        state.update {
            it.copy(loading = true, error = null, selectedYear = year, selectedMonth = month)
        }
        viewModelScope.launch {
            try {
                val response = repository.periodReview(year, month)
                val serverUrl = repository.activeServerUrl()
                state.update {
                    it.copy(
                        loading = false,
                        review = response.review,
                        periods = response.availablePeriods,
                        serverUrl = serverUrl,
                    )
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load review")
                }
            }
        }
    }
}
