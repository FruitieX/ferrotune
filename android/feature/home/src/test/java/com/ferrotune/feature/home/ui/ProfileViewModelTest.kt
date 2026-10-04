package com.ferrotune.feature.home.ui

import com.ferrotune.core.network.FerrotuneApiException
import com.ferrotune.core.network.generated.ListeningStats
import com.ferrotune.core.network.generated.ListeningStatsResponse
import com.ferrotune.core.network.generated.UserInfo
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.feature.home.data.HomeRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeProfileApi(private val listeningFails: Boolean = false) : FakeFerrotuneApi() {
        override suspend fun currentUser() = UserInfo(
            id = 1,
            username = "rasse",
            isAdmin = true,
            createdAt = "2024-03-05T10:00:00Z",
            libraryAccess = emptyList(),
        )

        override suspend fun listeningStats(): ListeningStatsResponse {
            if (listeningFails) throw FerrotuneApiException(0, "Can't reach the server")
            val period = ListeningStats(totalSeconds = 3600, sessionCount = 40, uniqueSongs = 12, skipCount = 10, scrobbleCount = 30)
            return ListeningStatsResponse(last7Days = period, last30Days = period, thisYear = period, allTime = period)
        }
    }

    @Test
    fun `loads the account and listening activity`() {
        val viewModel = ProfileViewModel(HomeRepository(FakeApiProvider(FakeProfileApi())))

        val state = viewModel.uiState.value
        assertEquals("rasse", state.user?.username)
        assertEquals(12L, state.listening?.allTime?.uniqueSongs)
        assertFalse(state.userLoading)
        assertFalse(state.listeningLoading)
    }

    @Test
    fun `a failed listening request keeps the account card`() {
        val viewModel = ProfileViewModel(HomeRepository(FakeApiProvider(FakeProfileApi(listeningFails = true))))

        val state = viewModel.uiState.value
        assertEquals("rasse", state.user?.username)
        assertNull(state.listening)
        assertEquals("Can't reach the server", state.listeningError)
    }

    @Test
    fun `skip rate and member since match the web`() {
        assertEquals(25, skipRatePercent(skips = 10, sessions = 40))
        assertEquals(0, skipRatePercent(skips = 3, sessions = 0))
        assertEquals("Unknown", formatMemberSince(null))
        assertEquals("Unknown", formatMemberSince("not a date"))
    }
}
