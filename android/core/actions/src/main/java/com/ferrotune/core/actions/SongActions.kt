package com.ferrotune.core.actions

import android.content.Context
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.designsystem.components.FavoriteButton
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SourceSongsRequest
import com.ferrotune.core.network.toQueryMap
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@EntryPoint
@InstallIn(SingletonComponent::class)
interface SongActionsEntryPoint {
    fun songFlagsStore(): SongFlagsStore

    fun playbackStarter(): PlaybackStarter
}

/**
 * Observable favorite state for one song: the server-provided value overlaid
 * with optimistic local changes. The overlay is dropped once the server data
 * catches up.
 */
@Composable
fun rememberSongFlags(songId: String, starred: Boolean, rating: Int = 0): SongFlags {
    val store = rememberSongFlagsStore()
    val overrides by store.overrides.collectAsStateWithLifecycle()
    val base = SongFlags(starred = starred, rating = rating)
    val override = overrides[songId]
    val current = override?.mergedWith(base) ?: base
    LaunchedEffect(songId, override, base) {
        if (override != null && override.isSatisfiedBy(base)) store.clear(songId)
    }
    return current
}

@Composable
private fun rememberSongFlagsStore(): SongFlagsStore {
    val context = LocalContext.current
    return remember(context) { songActionsEntryPoint(context).songFlagsStore() }
}

internal fun songActionsEntryPoint(context: Context): SongActionsEntryPoint =
    EntryPointAccessors.fromApplication(
        context.applicationContext,
        SongActionsEntryPoint::class.java,
    )

/** Mutations backing the shared song action menu. */
@HiltViewModel
class SongActionsViewModel @Inject constructor(
    private val store: SongFlagsStore,
    private val playbackStarter: PlaybackStarter,
    private val apiProvider: FerrotuneApiProvider,
    private val messages: UserMessages,
) : ViewModel() {

    private val _selectingAll = MutableStateFlow(false)
    val selectingAll: StateFlow<Boolean> = _selectingAll.asStateFlow()

    fun toggleStar(songId: String, base: SongFlags) {
        viewModelScope.launch {
            runCatching { store.setStarred(songId, !base.starred, base) }
                .onFailure { messages.failure("Couldn't update favorites", it) }
        }
    }

    fun setRating(songId: String, rating: Int) {
        viewModelScope.launch {
            runCatching { store.setRating(songId, rating) }
                .onFailure { messages.failure("Couldn't save rating", it) }
        }
    }

    fun setStarredBulk(songIds: List<String>, starred: Boolean) {
        viewModelScope.launch {
            runCatching { store.setStarredBulk(songIds, starred) }
                .onSuccess {
                    messages.show(
                        if (starred) "Added ${songCount(songIds.size)} to favorites"
                        else "Removed ${songCount(songIds.size)} from favorites",
                    )
                }
                .onFailure { messages.failure("Couldn't update favorites", it) }
        }
    }

    /**
     * Resolves every ID in a collection for "select all": either a queue
     * source descriptor or the search/filter params of the current list.
     */
    fun loadAllIds(
        sources: List<QueueSourceRequest>? = null,
        searchParams: SearchParams? = null,
        onLoaded: (List<String>) -> Unit,
    ) {
        if (sources == null && searchParams == null) return
        viewModelScope.launch {
            _selectingAll.value = true
            val ids = runCatching {
                when {
                    sources != null -> apiProvider.requireApi()
                        .sourceSongIds(SourceSongsRequest(sources = sources)).ids

                    else -> apiProvider.requireApi()
                        .songIds(searchParams!!.toQueryMap()).ids
                }
            }.onFailure { messages.failure("Couldn't select all songs", it) }
                .getOrDefault(emptyList())
            _selectingAll.value = false
            onLoaded(ids)
        }
    }

    fun playNext(songIds: List<String>) = queue(QueueAddSpec(songIds = songIds), QueueAddPosition.NEXT)

    fun addToQueue(songIds: List<String>) = queue(QueueAddSpec(songIds = songIds), QueueAddPosition.END)

    fun playNextSources(sources: List<QueueSourceRequest>) =
        queue(QueueAddSpec(sources = sources), QueueAddPosition.NEXT)

    fun addSourcesToQueue(sources: List<QueueSourceRequest>) =
        queue(QueueAddSpec(sources = sources), QueueAddPosition.END)

    /** Plays just [songId] (the web "Play" item on a song). */
    fun playSong(songId: String) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.startQueue(
                    QueueStartSpec(sourceType = "other", songIds = listOf(songId), startSongId = songId),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    private fun queue(spec: QueueAddSpec, position: QueueAddPosition) {
        viewModelScope.launch {
            runCatching { playbackStarter.addToQueue(spec, position) }
                .onSuccess {
                    val what = if (spec.songIds.isNotEmpty()) songCount(spec.songIds.size).replaceFirstChar { it.uppercase() } else "Songs"
                    messages.show(
                        when (position) {
                            QueueAddPosition.NEXT -> "$what will play next"
                            QueueAddPosition.END -> "$what added to queue"
                        },
                    )
                }
                .onFailure { messages.failure("Couldn't add to queue", it) }
        }
    }
}

internal fun songCount(count: Int): String = if (count == 1) "1 song" else "$count songs"

/** Favorite toggle with its own mutation wiring, for row/header placement. */
@Composable
fun SongFavoriteButton(
    songId: String,
    flags: SongFlags,
    modifier: Modifier = Modifier,
    iconSize: Dp = 22.dp,
    viewModel: SongActionsViewModel = hiltViewModel(),
) {
    FavoriteButton(
        isFavorite = flags.starred,
        onToggle = { viewModel.toggleStar(songId, flags) },
        modifier = modifier,
        iconSize = iconSize,
    )
}

