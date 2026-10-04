package com.ferrotune.feature.library.ui

import com.ferrotune.core.network.SORT_PREFERENCES_TIMEOUT_MS
import com.ferrotune.core.network.waitFor
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.media.queueSort
import com.ferrotune.core.media.queueTextFilter
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ArtistDetail
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.ViewSortConfig
import com.ferrotune.core.network.ViewSortKey
import com.ferrotune.core.network.ViewSortPreferencesRepository
import com.ferrotune.feature.library.data.LIBRARY_PAGE_SIZE
import com.ferrotune.feature.library.data.LibraryRepository
import com.ferrotune.feature.library.data.SongSort
import com.ferrotune.feature.library.data.SortDir
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

data class ArtistDetailUiState(
    val artist: ArtistDetail? = null,
    val serverUrl: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val filter: String = "",
    val sort: String = CUSTOM_SORT,
    val sortDir: SortDir = SortDir.ASC,
)

@HiltViewModel
class ArtistDetailViewModel @Inject constructor(
    private val repository: LibraryRepository,
    private val sessionStarter: PlaybackStarter,
    private val viewSortPreferences: ViewSortPreferencesRepository,
    private val messages: UserMessages,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val artistId: String = checkNotNull(savedStateHandle["artistId"])

    private val state = MutableStateFlow(ArtistDetailUiState())
    val uiState: StateFlow<ArtistDetailUiState> = state.asStateFlow()

    val albums: Flow<PagingData<AlbumResponse>> =
        Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
            repository.artistAlbums(artistId)
        }.flow.cachedIn(viewModelScope)

    private val filter = MutableStateFlow("")
    private val sortReady = MutableStateFlow(false)

    @OptIn(kotlinx.coroutines.FlowPreview::class)
    val songs: Flow<PagingData<SongResponse>> = combine(
        state.map { it.sort to it.sortDir }.distinctUntilChanged(),
        filter.debounce { if (it.isBlank()) 0L else 300L }.distinctUntilChanged(),
    ) { (sort, sortDir), filter -> Triple(sort, sortDir, filter) }
        .waitFor(sortReady)
        .flatMapLatest { (sort, sortDir, filter) ->
            Pager(PagingConfig(pageSize = LIBRARY_PAGE_SIZE)) {
                repository.artistSongs(
                    artistId,
                    sort = SongSort.entries.firstOrNull { it.apiValue == sort },
                    sortDir = sortDir,
                    filter = filter.ifBlank { null },
                )
            }.flow
        }
        .cachedIn(viewModelScope)

    init {
        viewModelScope.launch {
            try {
                val artist = repository.artist(artistId).artist
                val serverUrl = repository.activeServerUrl()
                state.update { it.copy(artist = artist, serverUrl = serverUrl, loading = false) }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e.message ?: "Failed to load artist") }
            }
        }
        viewModelScope.launch {
            withTimeoutOrNull(SORT_PREFERENCES_TIMEOUT_MS) { viewSortPreferences.ensureLoaded() }
            val stored = viewSortPreferences.config(
                ViewSortKey.ARTIST_DETAIL,
                ViewSortConfig(CUSTOM_SORT, SortDir.ASC.apiValue),
            )
            state.update {
                it.copy(
                    sort = stored.field.takeIf { field ->
                        DETAIL_SONG_SORT_OPTIONS.any { it.key == field }
                    } ?: CUSTOM_SORT,
                    sortDir = SortDir.fromApiValue(stored.direction) ?: SortDir.ASC,
                )
            }
            sortReady.value = true
        }
    }

    fun setFilter(value: String) {
        state.update { it.copy(filter = value) }
        filter.value = value
    }

    fun selectSort(key: String) {
        state.update { it.copy(sort = key) }
        persistSort()
    }

    fun toggleSortDir() {
        state.update { it.copy(sortDir = it.sortDir.opposite()) }
        persistSort()
    }

    private fun persistSort() {
        val current = state.value
        viewModelScope.launch {
            viewSortPreferences.setSort(
                ViewSortKey.ARTIST_DETAIL,
                current.sort,
                current.sortDir.apiValue,
            )
        }
    }

    /** Plays the artist's songs as listed (filter and sort included). */
    fun play(startSongId: String? = null, startIndex: Int = 0, shuffle: Boolean = false) {
        val current = state.value
        val artist = current.artist ?: return
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(
                        sourceType = "artist",
                        sourceId = artistId,
                        sourceName = artist.name,
                        filters = queueTextFilter(current.filter),
                        sort = current.sort
                            .takeIf { it != CUSTOM_SORT }
                            ?.let { queueSort(it, current.sortDir.apiValue) },
                        startSongId = startSongId,
                        startIndex = startIndex,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    /** Plays one of the artist's albums from the album grid. */
    fun playAlbum(album: AlbumResponse) {
        viewModelScope.launch {
            runCatching {
                sessionStarter.startQueue(
                    QueueStartSpec(sourceType = "album", sourceId = album.id, sourceName = album.name),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    /** Optimistically flips the artist favorite, reverting if the server refuses. */
    fun toggleStar() {
        val artist = state.value.artist ?: return
        val starred = artist.starred == null
        state.update { it.copy(artist = artist.copy(starred = if (starred) "now" else null)) }
        viewModelScope.launch {
            runCatching { repository.setStarred(artistIds = listOf(artistId), starred = starred) }
                .onFailure {
                    state.update { it.copy(artist = artist) }
                    messages.failure("Couldn't update favorites", it)
                }
        }
    }
}
