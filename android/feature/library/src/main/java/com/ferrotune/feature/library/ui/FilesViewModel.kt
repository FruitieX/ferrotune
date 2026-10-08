package com.ferrotune.feature.library.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.media.queueTextFilter
import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.core.network.generated.BreadcrumbItem
import com.ferrotune.core.network.generated.DirectoryChildPaged
import com.ferrotune.core.network.generated.DirectoryPagedResponse
import com.ferrotune.core.network.generated.LibraryInfo
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.readableMessage
import com.ferrotune.core.network.waitFor
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Web `filesSortOptions`. */
enum class FilesSort(val apiValue: String, val label: String) {
    NAME("name", "Name"),
    ARTIST("artist", "Artist"),
    ALBUM("album", "Album"),
    YEAR("year", "Year"),
    DURATION("duration", "Duration"),
    SIZE("size", "Size"),
    DATE_ADDED("dateAdded", "Date Added"),
}

/** A folder inside a library; [path] is relative to the library root ("" at the root). */
data class FilesLocation(val libraryId: Long, val path: String) {
    /** Queue source id for the `directory`/`directoryFlat` materializers. */
    val sourceId: String get() = "$libraryId:$path"

    val parentPath: String? get() = if (path.isEmpty()) null else path.substringBeforeLast('/', "")
}

/** The open folder's heading, from the first page of its listing. */
data class DirectorySummary(
    val location: FilesLocation,
    val name: String,
    val libraryName: String,
    val folderCount: Long,
    val fileCount: Long,
    val totalSize: Long,
    /** Ancestors below the library root, excluding the open folder (web breadcrumbs). */
    val ancestors: List<BreadcrumbItem>,
)

data class FilesUiState(
    val libraries: List<LibraryInfo> = emptyList(),
    val librariesLoading: Boolean = false,
    val librariesError: String? = null,
    val location: FilesLocation? = null,
    val summary: DirectorySummary? = null,
    val filter: String = "",
    val sort: FilesSort = FilesSort.NAME,
    val ascending: Boolean = true,
) {
    /** The library list filtered by name, like the web root view. */
    val visibleLibraries: List<LibraryInfo>
        get() = filter.trim().let { query ->
            if (query.isEmpty()) libraries else libraries.filter { it.name.contains(query, ignoreCase = true) }
        }

    /** Summary for the open folder only, never a stale one from the previous folder. */
    val currentSummary: DirectorySummary? get() = summary?.takeIf { it.location == location }
}

/**
 * The web Library → Files browser: pick a library, then walk its folders.
 * Listings, filtering, and sorting are server-side; playing a file queues the
 * open folder's files (`directoryFlat`) in the shown order, and folder
 * actions queue the whole subtree (`directory`).
 */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class FilesViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val sortPreferences: ViewSortPreferencesRepository,
    private val messages: UserMessages,
) : ViewModel() {
    private val state = MutableStateFlow(FilesUiState())
    val uiState: StateFlow<FilesUiState> = state.asStateFlow()

    private val sortReady = MutableStateFlow(false)
    private var librariesRequested = false

    val children: Flow<PagingData<DirectoryChildPaged>> = combine(
        state.map { it.location }.distinctUntilChanged(),
        state.map { it.sort to it.ascending }.distinctUntilChanged(),
        // Typing is debounced; clearing the filter applies at once.
        state.map { it.filter.trim() }.distinctUntilChanged().debounce { if (it.isEmpty()) 0L else 300L },
    ) { location, sort, filter -> Triple(location, sort, filter) }
        .distinctUntilChanged()
        .waitFor(sortReady)
        .flatMapLatest { (location, sort, filter) ->
            if (location == null) {
                flowOf(PagingData.empty())
            } else {
                Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                    repository.directory(
                        libraryId = location.libraryId,
                        path = location.path,
                        sort = sort.first.apiValue,
                        sortDir = if (sort.second) "asc" else "desc",
                        filter = filter.ifEmpty { null },
                        onFirstPage = { onListing(location, it) },
                    )
                }.flow
            }
        }
        .cachedIn(viewModelScope)

    init {
        viewModelScope.launch {
            val stored = withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { sortPreferences.ensureLoaded() }
                ?.get(ViewSortKey.FILES)
            stored?.let { config ->
                FilesSort.entries.firstOrNull { it.apiValue == config.field }?.let { sort ->
                    state.update { it.copy(sort = sort, ascending = config.direction != "desc") }
                }
            }
            sortReady.value = true
        }
    }

    /** Loads the library list the first time the Files tab shows. */
    fun activate() {
        if (librariesRequested) return
        librariesRequested = true
        loadLibraries()
    }

    fun loadLibraries() {
        state.update { it.copy(librariesLoading = true, librariesError = null) }
        viewModelScope.launch {
            runCatching { repository.libraries() }
                .onSuccess { libraries -> state.update { it.copy(libraries = libraries, librariesLoading = false) } }
                .onFailure { e ->
                    state.update {
                        it.copy(librariesLoading = false, librariesError = e.readableMessage() ?: "Couldn't load libraries")
                    }
                }
        }
    }

    fun setFilter(value: String) = state.update { it.copy(filter = value) }

    fun openLibrary(libraryId: Long) = state.update { it.copy(location = FilesLocation(libraryId, "")) }

    fun openFolder(path: String) = state.update { current ->
        current.location?.let { current.copy(location = it.copy(path = path)) } ?: current
    }

    /** Back to the library list. */
    fun showLibraries() = state.update { it.copy(location = null) }

    /** One level up: parent folder, then the library list. False when already there. */
    fun navigateUp(): Boolean {
        val location = state.value.location ?: return false
        val parent = location.parentPath
        state.update { it.copy(location = if (parent == null) null else location.copy(path = parent)) }
        return true
    }

    fun selectSort(key: String) {
        val sort = FilesSort.entries.firstOrNull { it.apiValue == key } ?: return
        state.update { if (it.sort == sort) it.copy(ascending = !it.ascending) else it.copy(sort = sort, ascending = true) }
        persistSort()
    }

    fun toggleSortDirection() {
        state.update { it.copy(ascending = !it.ascending) }
        persistSort()
    }

    /** Plays (or shuffles) the open folder including its subfolders. */
    fun playCurrentFolder(shuffle: Boolean) {
        val current = state.value
        val location = current.location ?: return
        startDirectory(location.sourceId, current.currentSummary?.name ?: "Folder", shuffle)
    }

    fun playFolder(folder: DirectoryChildPaged, shuffle: Boolean = false) {
        val location = state.value.location ?: return
        startDirectory(FilesLocation(location.libraryId, folder.path ?: folder.id).sourceId, folder.title, shuffle)
    }

    fun addCurrentFolderToQueue(position: QueueAddPosition) {
        val location = state.value.location ?: return
        addDirectory(location.sourceId, position)
    }

    fun addFolderToQueue(folder: DirectoryChildPaged, position: QueueAddPosition) {
        val location = state.value.location ?: return
        addDirectory(FilesLocation(location.libraryId, folder.path ?: folder.id).sourceId, position)
    }

    /**
     * Plays the open folder's files from [file]. Folders are listed before
     * files, so the file's queue index is its list position minus the folders.
     */
    fun playFile(file: DirectoryChildPaged, position: Int) {
        val current = state.value
        val location = current.location ?: return
        val folders = current.currentSummary?.folderCount?.toInt() ?: 0
        launchPlayback {
            sessionStarter.startQueue(
                QueueStartSpec(
                    sourceType = "directoryFlat",
                    sourceId = location.sourceId,
                    sourceName = current.currentSummary?.name ?: "Folder",
                    filters = queueTextFilter(current.filter),
                    sort = queueSort(current.sort.apiValue, if (current.ascending) "asc" else "desc"),
                    startIndex = (position - folders).coerceAtLeast(0),
                    startSongId = file.id,
                ),
            )
        }
    }

    private fun startDirectory(sourceId: String, name: String, shuffle: Boolean) {
        val filter = state.value.filter
        launchPlayback {
            sessionStarter.startQueue(
                QueueStartSpec(
                    sourceType = "directory",
                    sourceId = sourceId,
                    sourceName = name,
                    filters = queueTextFilter(filter),
                    shuffle = shuffle,
                ),
            )
        }
    }

    private fun addDirectory(sourceId: String, position: QueueAddPosition) {
        // Same filter as playing the folder, so both queue the same songs.
        val filters = queueTextFilter(state.value.filter).ifEmpty { null }
        viewModelScope.launch {
            runCatching {
                sessionStarter.addToQueue(
                    QueueAddSpec(
                        sources = listOf(
                            QueueSourceRequest(sourceType = "directory", sourceId = sourceId, filters = filters),
                        ),
                    ),
                    position,
                )
            }
                .onSuccess { messages.show(if (position == QueueAddPosition.NEXT) "Playing next" else "Added to queue") }
                .onFailure { messages.failure("Couldn't add to queue", it) }
        }
    }

    private fun launchPlayback(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    internal fun onListing(location: FilesLocation, response: DirectoryPagedResponse) {
        state.update {
            it.copy(
                summary = DirectorySummary(
                    location = location,
                    name = response.name,
                    libraryName = response.libraryName,
                    folderCount = response.folderCount,
                    fileCount = response.fileCount,
                    totalSize = response.totalSize,
                    ancestors = response.breadcrumbs.dropLast(1),
                ),
            )
        }
    }

    private fun persistSort() {
        val current = state.value
        viewModelScope.launch {
            sortPreferences.setSort(ViewSortKey.FILES, current.sort.apiValue, if (current.ascending) "asc" else "desc")
        }
    }
}
