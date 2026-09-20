package com.ferrotune.feature.library.ui

import com.ferrotune.feature.library.FakeApiProvider
import com.ferrotune.feature.library.FakeFerrotuneApi
import com.ferrotune.feature.library.FakePlaybackStarter
import com.ferrotune.feature.library.data.LibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(starter: FakePlaybackStarter = FakePlaybackStarter()) =
        SearchViewModel(LibraryRepository(FakeApiProvider(FakeFerrotuneApi())), starter)

    @Test
    fun `query changes update state`() {
        val viewModel = viewModel()

        viewModel.onQueryChange("beach")

        assertEquals("beach", viewModel.uiState.value.query)
    }

    @Test
    fun `playSong ignores blank queries`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter)
        viewModel.onQueryChange("   ")

        viewModel.playSong("song-1")

        assertTrue(starter.specs.isEmpty())
    }

    @Test
    fun `playSong starts a search queue with the trimmed query`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter)
        viewModel.onQueryChange("  beach house  ")

        viewModel.playSong("song-4")

        val spec = starter.specs.single()
        assertEquals("search", spec.sourceType)
        assertEquals("song-4", spec.startSongId)
        assertEquals("beach house", (spec.filters["query"] as JsonPrimitive).content)
    }
}
