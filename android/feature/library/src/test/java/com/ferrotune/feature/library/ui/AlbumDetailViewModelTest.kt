package com.ferrotune.feature.library.ui

import androidx.lifecycle.SavedStateHandle
import com.ferrotune.core.network.generated.AlbumDetail
import com.ferrotune.core.network.generated.FerrotuneAlbumResponse
import com.ferrotune.core.testing.FakeApiProvider
import com.ferrotune.core.testing.FakeFerrotuneApi
import com.ferrotune.core.testing.FakePlaybackStarter
import com.ferrotune.feature.library.data.LibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AlbumDetailViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val album = AlbumDetail(
        id = "album-1",
        name = "Bloom",
        artist = "Beach House",
        artistId = "artist-1",
        songCount = 10,
        duration = 3600,
        created = "2026-01-01T00:00:00.000Z",
    )

    private fun viewModel(starter: FakePlaybackStarter = FakePlaybackStarter()) =
        AlbumDetailViewModel(
            repository = LibraryRepository(
                FakeApiProvider(FakeFerrotuneApi(onAlbum = { FerrotuneAlbumResponse(album) }))
            ),
            sessionStarter = starter,
            savedStateHandle = SavedStateHandle(mapOf("albumId" to "album-1")),
        )

    @Test
    fun `album loads from the saved state argument`() {
        val viewModel = viewModel()

        assertEquals("Bloom", viewModel.uiState.value.album?.name)
        assertEquals("http://localhost:4040", viewModel.uiState.value.serverUrl)
        assertFalse(viewModel.uiState.value.loading)
    }

    @Test
    fun `play forwards the album and start song to the session starter`() {
        val starter = FakePlaybackStarter()
        val viewModel = viewModel(starter)

        viewModel.play("song-7")

        val start = starter.albumStarts.single()
        assertEquals("album-1", start.albumId)
        assertEquals("Bloom", start.sourceName)
        assertEquals("song-7", start.startSongId)
    }
}
