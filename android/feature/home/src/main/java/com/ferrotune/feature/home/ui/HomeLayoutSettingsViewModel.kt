package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.model.Account
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.home.data.HomePlaylistChoice
import com.ferrotune.feature.home.data.HomePlaylistChoicesRepository
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeTileConfig
import com.ferrotune.feature.home.data.normalizeHomeSections
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeLayoutSettingsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val tiles: List<HomeTileConfig> = emptyList(),
    val sections: List<HomeSectionConfig> = emptyList(),
    val playlistChoices: List<HomePlaylistChoice> = emptyList(),
    val accounts: List<Account> = emptyList(),
    val message: String? = null,
)

@HiltViewModel
class HomeLayoutSettingsViewModel @Inject constructor(
    private val layoutRepository: HomeLayoutPreferencesRepository,
    private val choicesRepository: HomePlaylistChoicesRepository,
    private val accounts: Accounts,
) : ViewModel() {

    private val state = MutableStateFlow(HomeLayoutSettingsUiState())
    val uiState: StateFlow<HomeLayoutSettingsUiState> = state.asStateFlow()

    init {
        viewModelScope.launch {
            accounts.accounts.collect { saved -> state.update { it.copy(accounts = saved) } }
        }
        load()
    }

    fun load() {
        viewModelScope.launch {
            state.update { it.copy(loading = true, error = null) }
            try {
                layoutRepository.ensureLoaded()
                val choices = runCatching { choicesRepository.choices() }.getOrDefault(emptyList())
                state.update {
                    it.copy(
                        loading = false,
                        tiles = layoutRepository.tiles.value,
                        sections = layoutRepository.sections.value,
                        playlistChoices = choices,
                    )
                }
            } catch (e: Exception) {
                state.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load home layout")
                }
            }
        }
    }

    fun addTile(tile: HomeTileConfig) {
        persistTiles(state.value.tiles + tile, "Could not save home tiles")
    }

    fun updateTile(tile: HomeTileConfig) {
        persistTiles(
            state.value.tiles.map { if (it.id == tile.id) tile else it },
            "Could not save home tiles",
        )
    }

    fun moveTile(tileId: String, delta: Int) {
        persistTiles(
            moveItem(state.value.tiles, tileId, delta) { it.id },
            "Could not save home tiles",
        )
    }

    fun removeTile(tileId: String) {
        persistTiles(
            state.value.tiles.filterNot { it.id == tileId },
            "Could not save home tiles",
        )
    }

    fun addSection(section: HomeSectionConfig) {
        persistSections(state.value.sections + section)
    }

    fun updateSection(section: HomeSectionConfig) {
        persistSections(state.value.sections.map { if (it.id == section.id) section else it })
    }

    fun setSectionEnabled(sectionId: String, enabled: Boolean) {
        persistSections(
            state.value.sections.map { if (it.id == sectionId) it.copy(enabled = enabled) else it },
        )
    }

    fun moveSection(sectionId: String, delta: Int) {
        persistSections(moveItem(state.value.sections, sectionId, delta) { it.id })
    }

    fun removeSection(sectionId: String) {
        persistSections(state.value.sections.filterNot { it.id == sectionId })
    }

    fun dismissMessage() = state.update { it.copy(message = null) }

    private fun persistTiles(tiles: List<HomeTileConfig>, errorMessage: String) {
        state.update { it.copy(tiles = tiles) }
        viewModelScope.launch {
            runCatching { layoutRepository.setTiles(tiles) }
                .onFailure { state.update { current -> current.copy(message = errorMessage) } }
        }
    }

    private fun persistSections(sections: List<HomeSectionConfig>) {
        val normalized = normalizeHomeSections(sections)
        state.update { it.copy(sections = normalized) }
        viewModelScope.launch {
            runCatching { layoutRepository.setSections(normalized) }
                .onFailure {
                    state.update { current -> current.copy(message = "Could not save home sections") }
                }
        }
    }

    private fun <T> moveItem(
        items: List<T>,
        id: String,
        delta: Int,
        idOf: (T) -> String,
    ): List<T> {
        val index = items.indexOfFirst { idOf(it) == id }
        if (index < 0) return items
        val target = (index + delta).coerceIn(0, items.lastIndex)
        if (target == index) return items
        return items.toMutableList().apply { add(target, removeAt(index)) }
    }
}
