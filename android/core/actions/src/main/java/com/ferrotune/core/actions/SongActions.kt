package com.ferrotune.core.actions

import android.content.Context
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import com.ferrotune.core.designsystem.components.RatingStars
import com.ferrotune.core.designsystem.components.StarButton
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
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
 * Observable star/rating state for one song: server-provided values overlaid
 * with optimistic local changes. The overlay is dropped once the server data
 * catches up.
 */
@Composable
fun rememberSongFlags(songId: String, starred: Boolean, rating: Int): SongFlags {
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
    return remember(context) { songFlagsEntryPoint(context).songFlagsStore() }
}

private fun songFlagsEntryPoint(context: Context): SongActionsEntryPoint =
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
) : ViewModel() {

    private val _selectingAll = MutableStateFlow(false)
    val selectingAll: StateFlow<Boolean> = _selectingAll.asStateFlow()

    fun toggleStar(songId: String, base: SongFlags) {
        viewModelScope.launch {
            runCatching { store.setStarred(songId, !base.starred, base) }
        }
    }

    fun setRating(songId: String, rating: Int, base: SongFlags) {
        viewModelScope.launch {
            runCatching { store.setRating(songId, rating, base) }
        }
    }

    fun setStarredBulk(songIds: List<String>, starred: Boolean) {
        viewModelScope.launch {
            runCatching { store.setStarredBulk(songIds, starred) }
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
            }.getOrDefault(emptyList())
            _selectingAll.value = false
            onLoaded(ids)
        }
    }

    fun playNext(songIds: List<String>) {
        viewModelScope.launch {
            runCatching { playbackStarter.addToQueue(QueueAddSpec(songIds = songIds), QueueAddPosition.NEXT) }
        }
    }

    fun addToQueue(songIds: List<String>) {
        viewModelScope.launch {
            runCatching { playbackStarter.addToQueue(QueueAddSpec(songIds = songIds), QueueAddPosition.END) }
        }
    }

    fun playNextSources(sources: List<QueueSourceRequest>) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.addToQueue(QueueAddSpec(sources = sources), QueueAddPosition.NEXT)
            }
        }
    }

    fun addSourcesToQueue(sources: List<QueueSourceRequest>) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.addToQueue(QueueAddSpec(sources = sources), QueueAddPosition.END)
            }
        }
    }
}

/**
 * Shared dropdown items for song actions: play next, add to queue, song radio,
 * star toggle, and inline rating. Features append their own items via
 * [extraItems].
 */
@Composable
fun SongMenuItems(
    flags: SongFlags,
    onPlayNext: () -> Unit,
    onAddToQueue: () -> Unit,
    onToggleStar: () -> Unit,
    onRate: (Int) -> Unit,
    onOpenSongRadio: (() -> Unit)? = null,
    extraItems: (@Composable () -> Unit)? = null,
) {
    DropdownMenuItem(
        text = { Text("Play next") },
        leadingIcon = { Icon(Icons.Filled.PlaylistPlay, contentDescription = null) },
        onClick = onPlayNext,
    )
    DropdownMenuItem(
        text = { Text("Add to queue") },
        leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
        onClick = onAddToQueue,
    )
    if (onOpenSongRadio != null) {
        DropdownMenuItem(
            text = { Text("Song radio") },
            leadingIcon = { Icon(Icons.Filled.Radio, contentDescription = null) },
            onClick = onOpenSongRadio,
        )
    }
    DropdownMenuItem(
        text = { Text(if (flags.starred) "Remove from favorites" else "Add to favorites") },
        leadingIcon = {
            Icon(
                imageVector = if (flags.starred) Icons.Filled.Star else Icons.Filled.StarBorder,
                contentDescription = null,
            )
        },
        onClick = onToggleStar,
    )
    Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        RatingStars(rating = flags.rating, onRate = onRate)
    }
    extraItems?.invoke()
}

/** Dropdown host for [SongActionsMenuContent] with feature-supplied extras. */
@Composable
fun SongRowMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    songId: String,
    flags: SongFlags,
    onOpenSongRadio: (() -> Unit)? = null,
    extraItems: (@Composable () -> Unit)? = null,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        SongActionsMenuContent(
            songId = songId,
            flags = flags,
            onOpenSongRadio = onOpenSongRadio,
            extraItems = extraItems,
            onDismiss = onDismiss,
        )
    }
}

/** Star toggle with its own mutation wiring, for row/header placement. */
@Composable
fun SongStarButton(
    songId: String,
    flags: SongFlags,
    modifier: Modifier = Modifier,
    iconSize: Dp = 22.dp,
    viewModel: SongActionsViewModel = hiltViewModel(),
) {
    StarButton(
        isStarred = flags.starred,
        onToggle = { viewModel.toggleStar(songId, flags) },
        modifier = modifier,
        iconSize = iconSize,
    )
}

/**
 * Self-contained song action menu content. Hosts its own ViewModel so any
 * feature can use it inside a `DropdownMenu` without extra wiring.
 */
@Composable
fun SongActionsMenuContent(
    songId: String,
    flags: SongFlags,
    onOpenSongRadio: (() -> Unit)? = null,
    extraItems: (@Composable () -> Unit)? = null,
    onDismiss: () -> Unit = {},
    viewModel: SongActionsViewModel = hiltViewModel(),
) {
    SongMenuItems(
        flags = flags,
        onPlayNext = {
            onDismiss()
            viewModel.playNext(listOf(songId))
        },
        onAddToQueue = {
            onDismiss()
            viewModel.addToQueue(listOf(songId))
        },
        onToggleStar = {
            onDismiss()
            viewModel.toggleStar(songId, flags)
        },
        onRate = { rating ->
            onDismiss()
            viewModel.setRating(songId, rating, flags)
        },
        onOpenSongRadio = onOpenSongRadio?.let { open ->
            {
                onDismiss()
                open()
            }
        },
        extraItems = extraItems,
    )
}
