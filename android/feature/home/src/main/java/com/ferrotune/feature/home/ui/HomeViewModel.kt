package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.HomePageResponse
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.home.data.HomeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val serverUrl: String? = null,
    val page: HomePageResponse? = null,
    val playbackError: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: HomeRepository,
    private val sessionStarter: PlaybackStarter,
) : ViewModel() {

    private val state = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = state.asStateFlow()

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val page = repository.home()
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(loading = false, page = page, serverUrl = serverUrl) }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load home")
                }
            }
        }
    }

    fun playAlbum(album: AlbumResponse, startSongId: String? = null) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = SOURCE_TYPE_ALBUM,
                        sourceId = album.id,
                        sourceName = album.name,
                        startSongId = startSongId,
                    )
                )
            } catch (e: Exception) {
                onPlaybackError(e)
            }
        }
    }

    fun playSection(
        sourceType: String,
        sourceName: String,
        song: SongResponse,
    ) {
        viewModelScope.launch {
            try {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = sourceType,
                        sourceName = sourceName,
                        startSongId = song.id,
                    )
                )
            } catch (e: Exception) {
                onPlaybackError(e)
            }
        }
    }

    fun playContinueListening(entry: ContinueListeningEntry) {
        viewModelScope.launch {
            try {
                val spec = when (entry.type) {
                    SOURCE_TYPE_ALBUM -> QueueStartSpec(
                        sourceType = SOURCE_TYPE_ALBUM,
                        sourceId = entry.album?.id,
                        sourceName = entry.album?.name,
                    )

                    SOURCE_TYPE_PLAYLIST, SOURCE_TYPE_SMART_PLAYLIST -> QueueStartSpec(
                        sourceType = entry.type,
                        sourceId = entry.playlist?.id,
                        sourceName = entry.playlist?.name,
                    )

                    else -> QueueStartSpec(
                        sourceType = entry.source?.sourceType ?: entry.type,
                        sourceId = entry.source?.id,
                        sourceName = entry.source?.name,
                    )
                }
                sessionStarter.startQueue(spec)
            } catch (e: Exception) {
                onPlaybackError(e)
            }
        }
    }

    fun dismissPlaybackError() = state.update { it.copy(playbackError = null) }

    private fun onPlaybackError(e: Exception) {
        state.update { it.copy(playbackError = e.message ?: "Unable to start playback") }
    }

    companion object {
        const val SOURCE_TYPE_ALBUM = "album"
        const val SOURCE_TYPE_PLAYLIST = "playlist"
        const val SOURCE_TYPE_SMART_PLAYLIST = "smartPlaylist"
        const val SOURCE_TYPE_MOST_PLAYED = "mostPlayedRecently"
        const val SOURCE_TYPE_FORGOTTEN_FAVORITES = "forgottenFavorites"
        const val SOURCE_TYPE_SIMILAR_TRACKS = "similarTracks"
    }
}
