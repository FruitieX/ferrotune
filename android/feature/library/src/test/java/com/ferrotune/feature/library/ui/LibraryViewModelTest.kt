package com.ferrotune.feature.library.ui

import com.ferrotune.core.network.generated.FerrotuneGenresResponse
import com.ferrotune.core.network.generated.GenreResponse
import com.ferrotune.core.network.generated.GenresList
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: FakeFerrotuneApi = FakeFerrotuneApi(),
        starter: FakePlaybackStarter = FakePlaybackStarter(),
    ) = LibraryViewModel(LibraryRepository(FakeApiProvider(api)), starter)

    @Test
    fun `song sort selection and direction are independent per tab`() {
        val viewModel = viewModel()

        viewModel.selectSongSort(SongSort.ARTIST)
        viewModel.toggleSongSortDir()

        assertEquals(SongSort.ARTIST, viewModel.uiState.value.songSort)
        assertEquals(SortDir.DESC, viewModel.uiState.value.songSortDir)
        assertEquals(SortDir.ASC, viewModel.uiState.value.albumSortDir)
    }

    @Test
    fun `genres load populates state`() {
        val api = FakeFerrotuneApi(
            onGenres = {
                FerrotuneGenresResponse(
                    GenresList(listOf(GenreResponse(value = "Rock", songCount = 3, albumCount = 1)))
                )
            }
        )

        val viewModel = viewModel(api)

        assertEquals(listOf("Rock"), viewModel.uiState.value.genres.map { it.value })
        assertFalse(viewModel.uiState.value.genresLoading)
        assertNull(viewModel.uiState.value.genresError)
    }

    @Test
    fun `genres failure surfaces an error`() {
        val api = FakeFerrotuneApi(onGenres = { throw IllegalStateException("boom") })

        val viewModel = viewModel(api)

        assertEquals("boom", viewModel.uiState.value.genresError)
        assertFalse(viewModel.uiState.value.genresLoading)
    }

    @Test
    fun `playSong starts a library queue with the current sort`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter = starter)
        viewModel.selectSongSort(SongSort.DATE_ADDED)

        viewModel.playSong("song-9")

        val spec = starter.specs.single()
        assertEquals("library", spec.sourceType)
        assertEquals("song-9", spec.startSongId)
        assertEquals("dateAdded", (spec.sort?.get("field") as JsonPrimitive).content)
        assertEquals("asc", (spec.sort?.get("direction") as JsonPrimitive).content)
    }

    @Test
    fun `playSong failure surfaces a playback error`() {
        val viewModel = viewModel(starter = FakePlaybackStarter(failure = "offline"))

        viewModel.playSong("song-1")

        assertEquals("offline", viewModel.uiState.value.playbackError)
    }
}
