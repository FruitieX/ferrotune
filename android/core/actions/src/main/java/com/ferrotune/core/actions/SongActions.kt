package com.ferrotune.core.actions

import android.content.Context
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.outlined.FavoriteBorder
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
import com.ferrotune.core.designsystem.components.FavoriteButton
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
 * Observable favorite state for one song: the server-provided value overlaid
 * with optimistic local changes. The overlay is dropped once the server data
 * catches up.
 */
@Composable
fun rememberSongFlags(songId: String, starred: Boolean): SongFlags {
    val store = rememberSongFlagsStore()
    val overrides by store.overrides.collectAsStateWithLifecycle()
    val base = SongFlags(starred = starred)
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
 * favorite toggle, and selection. Features append their own items via
 * [extraItems].
 */
@Composable
fun SongMenuItems(
    flags: SongFlags,
    onPlayNext: () -> Unit,
    onAddToQueue: () -> Unit,
    onToggleStar: () -> Unit,
    onOpenSongRadio: (() -> Unit)? = null,
    onStartSelection: (() -> Unit)? = null,
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
                imageVector = if (flags.starred) {
                    Icons.Filled.Favorite
                } else {
                    Icons.Outlined.FavoriteBorder
                },
                contentDescription = null,
            )
        },
        onClick = onToggleStar,
    )
    if (onStartSelection != null) {
        DropdownMenuItem(
            text = { Text("Select") },
            leadingIcon = { Icon(Icons.Filled.Checklist, contentDescription = null) },
            onClick = onStartSelection,
        )
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
    onStartSelection: (() -> Unit)? = null,
    extraItems: (@Composable () -> Unit)? = null,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        SongActionsMenuContent(
            songId = songId,
            flags = flags,
            onOpenSongRadio = onOpenSongRadio,
            onStartSelection = onStartSelection,
            extraItems = extraItems,
            onDismiss = onDismiss,
        )
    }
}

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

/**
 * Self-contained song action menu content. Hosts its own ViewModel so any
 * feature can use it inside a `DropdownMenu` without extra wiring.
 */
@Composable
fun SongActionsMenuContent(
    songId: String,
    flags: SongFlags,
    onOpenSongRadio: (() -> Unit)? = null,
    onStartSelection: (() -> Unit)? = null,
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
        onOpenSongRadio = onOpenSongRadio?.let { open ->
            {
                onDismiss()
                open()
            }
        },
        onStartSelection = onStartSelection?.let { select ->
            {
                onDismiss()
                select()
            }
        },
        extraItems = extraItems,
    )
}
