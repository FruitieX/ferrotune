package com.ferrotune.feature.home.ui

import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.feature.home.data.HomeRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load populates review and periods`() {
        val api = FakeHomeApi()

        val viewModel = ReviewViewModel(HomeRepository(FakeApiProvider(api)))

        assertEquals(2026, viewModel.uiState.value.review?.year)
        assertEquals(2, viewModel.uiState.value.periods.size)
        assertEquals("medium", api.reviewParams?.get("inlineImages"))
    }

    @Test
    fun `selecting a period forwards year and month`() {
        val api = FakeHomeApi()
        val viewModel = ReviewViewModel(HomeRepository(FakeApiProvider(api)))

        viewModel.load(year = 2026, month = 3)

        assertEquals("2026", api.reviewParams?.get("year"))
        assertEquals("3", api.reviewParams?.get("month"))
        assertEquals(2026, viewModel.uiState.value.selectedYear)
        assertEquals(3, viewModel.uiState.value.selectedMonth)
    }
}
