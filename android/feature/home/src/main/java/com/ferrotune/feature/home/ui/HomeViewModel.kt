package com.ferrotune.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.model.Account
import com.ferrotune.core.network.AccountSwitchResult
import com.ferrotune.core.network.AccountSwitcher
import com.ferrotune.core.network.generated.AlbumResponse
import com.ferrotune.core.network.generated.ContinueListeningEntry
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.feature.home.data.HomeLayoutPreferencesRepository
import com.ferrotune.feature.home.data.HomeRepository
import com.ferrotune.feature.home.data.HomeSectionLoader
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.serialization.json.JsonElement
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeSectionUi(
    val config: HomeSectionConfig,
    val songs: List<SongResponse> = emptyList(),
    val albums: List<AlbumResponse> = emptyList(),
    val entries: List<ContinueListeningEntry> = emptyList(),
    val seed: Long? = null,
    val queueFilters: Map<String, JsonElement> = emptyMap(),
) {
    val isEmpty: Boolean
        get() = songs.isEmpty() && albums.isEmpty() && entries.isEmpty()
}

data class HomeUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val serverUrl: String? = null,
    val tiles: List<HomeTilePresentation> = emptyList(),
    val sections: List<HomeSectionUi> = emptyList(),
    val accounts: List<Account> = emptyList(),
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: HomeRepository,
    private val layoutRepository: HomeLayoutPreferencesRepository,
    private val sectionLoader: HomeSectionLoader,
    private val sessionStarter: PlaybackStarter,
    private val accounts: Accounts,
    private val accountSwitcher: AccountSwitcher,
    private val messages: UserMessages,
) : ViewModel() {

    private val state = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = state.asStateFlow()

    init {
        viewModelScope.launch {
            accounts.activeAccount
                .map { it?.id }
                .distinctUntilChanged()
                .collectLatest {
                    layoutRepository.ensureLoaded()
                    combine(
                        layoutRepository.tiles,
                        layoutRepository.sections,
                    ) { _, _ -> Unit }.collect { reload() }
                }
        }
        viewModelScope.launch {
            accounts.accounts.collect { saved ->
                state.update { it.copy(accounts = saved) }
            }
        }
    }

    fun load() {
        viewModelScope.launch { reload() }
    }

    private suspend fun reload() {
        state.update { it.copy(loading = true, error = null) }
        layoutRepository.ensureLoaded()
        val sections = layoutRepository.sections.value
            .filter { it.enabled }
            .filter { it.kind != HomeSectionKind.PLAYLIST_SONGS || it.isPlaylistConfigured }

        val results = coroutineScope {
            sections
                .map { section ->
                    async {
                        section to runCatching { sectionLoader.load(section) }
                    }
                }
                .awaitAll()
        }

        val loaded = results.mapNotNull { (section, result) ->
            result.getOrNull()?.let { section to it }
        }
        val failure = results.firstNotNullOfOrNull { (_, result) -> result.exceptionOrNull() }

        state.update {
            it.copy(
                loading = false,
                error = if (loaded.isEmpty() && sections.isNotEmpty()) {
                    failure?.message ?: "Failed to load home"
                } else {
                    null
                },
                serverUrl = runCatching { repository.activeServerUrl() }.getOrNull(),
                tiles = layoutRepository.tiles.value.map { tile ->
                    homeTilePresentation(tile, layoutRepository.sections.value)
                },
                sections = loaded.map { (section, data) ->
                    HomeSectionUi(
                        config = section,
                        songs = data.songs,
                        albums = data.albums,
                        entries = data.entries,
                        seed = data.seed,
                        queueFilters = data.queueFilters,
                    )
                },
            )
        }
    }

    fun onTileAction(action: HomeTileAction) {
        when (action) {
            is HomeTileAction.Queue -> startQueue(action.spec)
            is HomeTileAction.SwitchAccount -> switchAccount(action.accountKey)
            is HomeTileAction.Link -> Unit
        }
    }

    fun playSection(section: HomeSectionUi, shuffle: Boolean) {
        startQueue(homeSectionQueueSpec(section.config, shuffle, section.queueFilters))
    }

    /** Plays [song] within its section's queue, matching the shelf's order. */
    fun playSong(section: HomeSectionUi, song: SongResponse, position: Int) {
        startQueue(homeSectionSongQueueSpec(section.config, section.queueFilters, song.id, position))
    }

    fun playContinueListening(entry: ContinueListeningEntry) {
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
        startQueue(spec)
    }

    fun switchAccount(accountKey: String?) {
        if (accountKey.isNullOrBlank()) return
        viewModelScope.launch {
            when (val result = accountSwitcher.switchTo(accountKey)) {
                is AccountSwitchResult.Failure -> messages.error(result.message)
                AccountSwitchResult.Success -> Unit
            }
        }
    }

    private fun startQueue(spec: QueueStartSpec) {
        viewModelScope.launch {
            runCatching { sessionStarter.startQueue(spec) }
                .onFailure { messages.failure("Couldn't start playback", it) }
        }
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
