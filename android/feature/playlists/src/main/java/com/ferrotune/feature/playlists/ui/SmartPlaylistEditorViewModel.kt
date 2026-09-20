package com.ferrotune.feature.playlists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.network.generated.CreateSmartPlaylistRequest
import com.ferrotune.core.network.generated.MusicFolderInfo
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.SmartPlaylistRulesApi
import com.ferrotune.core.network.generated.UpdateSmartPlaylistRequest
import com.ferrotune.feature.playlists.data.PlaylistFolderNode
import com.ferrotune.feature.playlists.data.PlaylistRepository
import com.ferrotune.feature.playlists.data.RuleField
import com.ferrotune.feature.playlists.data.SmartConditionDraft
import com.ferrotune.feature.playlists.data.buildPlaylistTree
import com.ferrotune.feature.playlists.data.fieldByName
import com.ferrotune.feature.playlists.data.newConditionDraft
import com.ferrotune.feature.playlists.data.operatorNeedsValue
import com.ferrotune.feature.playlists.data.operatorsFor
import com.ferrotune.feature.playlists.data.ruleFields
import com.ferrotune.feature.playlists.data.toApiCondition
import com.ferrotune.feature.playlists.data.toDraft
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

data class SmartPlaylistSortOption(val value: String?, val label: String)

val SMART_PLAYLIST_SORT_OPTIONS = listOf(
    SmartPlaylistSortOption(null, "Random"),
    SmartPlaylistSortOption("title", "Title"),
    SmartPlaylistSortOption("artist", "Artist"),
    SmartPlaylistSortOption("album", "Album"),
    SmartPlaylistSortOption("year", "Year"),
    SmartPlaylistSortOption("playCount", "Play Count"),
    SmartPlaylistSortOption("playStarts", "Play Starts"),
    SmartPlaylistSortOption("dateAdded", "Date Added"),
    SmartPlaylistSortOption("lastPlayed", "Last Played"),
    SmartPlaylistSortOption("duration", "Duration"),
)

data class SmartPlaylistEditorUiState(
    val isEditing: Boolean = false,
    val loading: Boolean = true,
    val saving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
    val name: String = "",
    val comment: String = "",
    val isPublic: Boolean = false,
    val logic: String = "and",
    val maxSongs: String = "",
    val sortField: String? = null,
    val sortDirection: String = "asc",
    val folderId: String? = null,
    val conditions: List<SmartConditionDraft> = emptyList(),
    val fields: List<RuleField> = emptyList(),
    val folderNodes: List<PlaylistFolderNode> = emptyList(),
    val playlists: List<PlaylistInFolder> = emptyList(),
    val musicFolders: List<MusicFolderInfo> = emptyList(),
) {
    val canSave: Boolean
        get() = name.isNotBlank() &&
            conditions.isNotEmpty() &&
            conditions.all { it.isComplete(fields) }
}

private fun SmartConditionDraft.isComplete(fields: List<RuleField>): Boolean {
    if (!operatorNeedsValue(operator)) return true
    return toApiCondition(fields) != null
}

@HiltViewModel
class SmartPlaylistEditorViewModel @Inject constructor(
    private val repository: PlaylistRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val smartPlaylistId: String? = savedStateHandle["smartPlaylistId"]
    private var nextConditionId = 1L

    private val _uiState = MutableStateFlow(
        SmartPlaylistEditorUiState(isEditing = smartPlaylistId != null),
    )
    val uiState: StateFlow<SmartPlaylistEditorUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    private fun load() {
        viewModelScope.launch {
            try {
                val folders = repository.folders()
                val musicFolders = repository.musicFolders()
                val fields = ruleFields(musicFolders, folders.playlists, folders.folders)
                val base = _uiState.value.copy(
                    loading = false,
                    fields = fields,
                    folderNodes = buildPlaylistTree(folders.folders, folders.playlists).folders,
                    playlists = folders.playlists,
                    musicFolders = musicFolders,
                )
                _uiState.value = if (smartPlaylistId == null) {
                    base.copy(conditions = listOf(newConditionDraft(fields, nextConditionId++)))
                } else {
                    val info = repository.smartPlaylist(smartPlaylistId)
                    base.copy(
                        name = info.name,
                        comment = info.comment.orEmpty(),
                        isPublic = info.isPublic,
                        logic = info.rules.logic,
                        maxSongs = info.maxSongs?.toString().orEmpty(),
                        sortField = info.sortField,
                        sortDirection = info.sortDirection ?: "asc",
                        folderId = info.folderId,
                        conditions = info.rules.conditions
                            .map { it.toDraft(nextConditionId++) }
                            .ifEmpty { listOf(newConditionDraft(fields, nextConditionId++)) },
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(loading = false, error = e.message ?: "Failed to load smart playlist")
                }
            }
        }
    }

    fun setName(value: String) = _uiState.update { it.copy(name = value) }

    fun setComment(value: String) = _uiState.update { it.copy(comment = value) }

    fun setPublic(value: Boolean) = _uiState.update { it.copy(isPublic = value) }

    fun setLogic(value: String) = _uiState.update { it.copy(logic = value) }

    fun setMaxSongs(value: String) = _uiState.update { it.copy(maxSongs = value.filter { c -> c.isDigit() }) }

    fun setSortField(value: String?) = _uiState.update { it.copy(sortField = value) }

    fun setSortDirection(value: String) = _uiState.update { it.copy(sortDirection = value) }

    fun setFolderId(value: String?) = _uiState.update { it.copy(folderId = value) }

    fun addCondition() = _uiState.update { state ->
        state.copy(conditions = state.conditions + newConditionDraft(state.fields, nextConditionId++))
    }

    fun removeCondition(id: Long) = _uiState.update { state ->
        state.copy(conditions = state.conditions.filterNot { it.id == id })
    }

    fun updateCondition(draft: SmartConditionDraft) = _uiState.update { state ->
        state.copy(conditions = state.conditions.map { if (it.id == draft.id) draft else it })
    }

    fun changeConditionField(id: Long, fieldName: String) = _uiState.update { state ->
        val field = state.fields.fieldByName(fieldName) ?: return@update state
        state.copy(
            conditions = state.conditions.map { draft ->
                if (draft.id != id) {
                    draft
                } else {
                    draft.copy(
                        field = fieldName,
                        operator = operatorsFor(field.type).first().value,
                        text = "",
                        number = "",
                        boolean = false,
                        selected = emptySet(),
                    )
                }
            },
        )
    }

    fun save() {
        val state = _uiState.value
        if (!state.canSave || state.saving) return
        viewModelScope.launch {
            _uiState.update { it.copy(saving = true, error = null) }
            try {
                val conditions = state.conditions.mapNotNull { it.toApiCondition(state.fields) }
                val rules = SmartPlaylistRulesApi(conditions = conditions, logic = state.logic)
                val maxSongs = state.maxSongs.toLongOrNull()
                if (smartPlaylistId == null) {
                    repository.createSmartPlaylist(
                        CreateSmartPlaylistRequest(
                            name = state.name.trim(),
                            comment = state.comment.ifBlank { null },
                            isPublic = state.isPublic,
                            rules = rules,
                            sortField = state.sortField,
                            sortDirection = state.sortDirection,
                            maxSongs = maxSongs,
                            folderId = state.folderId,
                        ),
                    )
                } else {
                    repository.updateSmartPlaylist(
                        smartPlaylistId,
                        UpdateSmartPlaylistRequest(
                            name = state.name.trim(),
                            comment = state.comment.ifBlank { null },
                            isPublic = state.isPublic,
                            rules = rules,
                            sortField = state.sortField,
                            sortDirection = state.sortDirection,
                            maxSongs = maxSongs?.let { JsonPrimitive(it) } ?: JsonNull,
                            folderId = state.folderId?.let { JsonPrimitive(it) } ?: JsonNull,
                        ),
                    )
                }
                _uiState.update { it.copy(saving = false, saved = true) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(saving = false, error = e.message ?: "Failed to save smart playlist")
                }
            }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}