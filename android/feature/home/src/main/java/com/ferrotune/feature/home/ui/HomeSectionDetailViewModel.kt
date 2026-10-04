package com.ferrotune.feature.home.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import kotlinx.serialization.json.JsonElement
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.home.data.DEFAULT_HOME_SECTIONS
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.home.data.HomeRepository
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionLoader
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeSectionDetailUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val section: HomeSectionConfig? = null,
    val songs: List<SongResponse> = emptyList(),
    val albums: List<AlbumResponse> = emptyList(),
    val entries: List<ContinueListeningEntry> = emptyList(),
    val queueFilters: Map<String, JsonElement> = emptyMap(),
)

@HiltViewModel
class HomeSectionDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: HomeRepository,
    private val layoutRepository: HomeLayoutPreferencesRepository,
    private val sectionLoader: HomeSectionLoader,
    private val sessionStarter: PlaybackStarter,
    private val messages: UserMessages,
) : ViewModel() {

    private val sectionId: String = checkNotNull(savedStateHandle["sectionId"]) {
        "sectionId is required"
    }

    private val state = MutableStateFlow(HomeSectionDetailUiState())
    val uiState: StateFlow<HomeSectionDetailUiState> = state.asStateFlow()

    init {
        load()
    }

    fun load() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                layoutRepository.ensureLoaded()
                val section = layoutRepository.sections.value.firstOrNull { it.id == sectionId }
                    ?: DEFAULT_HOME_SECTIONS.firstOrNull { it.id == sectionId }
                if (section == null) {
                    state.update { it.copy(loading = false, error = "Section not found") }
                    return@launch
                }
                val data = sectionLoader.load(section, size = MAX_SECTION_ITEMS)
                state.update {
                    it.copy(
                        loading = false,
                        section = section,
                        songs = data.songs,
                        albums = data.albums,
                        entries = data.entries,
                        queueFilters = data.queueFilters,
                    )
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load section")
                }
            }
        }
    }

    fun playAll(shuffle: Boolean) {
        val current = state.value
        val section = current.section ?: return
        startQueue(homeSectionQueueSpec(section, shuffle, current.queueFilters))
    }

    fun playSong(song: SongResponse, position: Int) {
        val current = state.value
        val section = current.section ?: return
        startQueue(homeSectionSongQueueSpec(section, current.queueFilters, song.id, position))
    }

    fun playAlbum(album: AlbumResponse) {
        startQueue(
            QueueStartSpec(
                sourceType = "album",
                sourceId = album.id,
                sourceName = album.name,
            ),
        )
    }

    fun playEntry(entry: ContinueListeningEntry) {
        val spec = when (entry.type) {
            "album" -> QueueStartSpec(
                sourceType = "album",
                sourceId = entry.album?.id,
                sourceName = entry.album?.name,
            )

            "playlist", "smartPlaylist" -> QueueStartSpec(
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
        startQueue(spec)
    }

    private fun startQueue(spec: QueueStartSpec) {
        viewModelScope.launch {
            runCatching { sessionStarter.startQueue(spec) }
                .onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    companion object {
        const val MAX_SECTION_ITEMS = 100L
    }
}
