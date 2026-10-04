package com.ferrotune.core.actions

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.StarRequest
import com.ferrotune.core.network.generated.QueueSourceRequest
import com.ferrotune.core.network.generated.SourceSongsRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

/** Queue source descriptors for the collection menus. */
object CollectionSource {
    const val ALBUM = "album"
    const val ARTIST = "artist"
    const val PLAYLIST = "playlist"
    const val SMART_PLAYLIST = "smartPlaylist"
    const val GENRE = "genre"
}

/** One album/artist/playlist target for [CollectionMenuSheet]. */
@Immutable
data class CollectionTarget(
    val sourceType: String,
    val sourceId: String,
    val name: String? = null,
    val subtitle: String? = null,
    val coverModel: Any? = null,
    /** Shown as "Go to artist" for albums. */
    val artistId: String? = null,
    /** Favorite state for albums/artists; null hides the favorite item. */
    val starred: Boolean? = null,
)

/** Screen-level holder so lists compose one collection sheet, not one per item. */
@Stable
class CollectionMenuState {
    var target by mutableStateOf<CollectionTarget?>(null)
        private set

    fun open(target: CollectionTarget) {
        this.target = target
    }

    fun close() {
        target = null
    }
}

@Composable
fun rememberCollectionMenuState(): CollectionMenuState = remember { CollectionMenuState() }

/** Playback and library mutations backing the shared collection menus. */
@HiltViewModel
class CollectionActionsViewModel @Inject constructor(
    private val playbackStarter: PlaybackStarter,
    private val apiProvider: FerrotuneApiProvider,
    private val messages: UserMessages,
) : ViewModel() {

    /** Optimistic favorite state per collection id for the session. */
    val starredOverrides = mutableStateMapOf<String, Boolean>()

    fun play(target: CollectionTarget, shuffle: Boolean = false) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.startQueue(
                    QueueStartSpec(
                        sourceType = target.sourceType,
                        sourceId = target.sourceId,
                        sourceName = target.name,
                        shuffle = shuffle,
                    ),
                )
            }.onFailure { messages.failure("Couldn't start playback", it) }
        }
    }

    fun playNext(target: CollectionTarget) = queue(target, QueueAddPosition.NEXT)

    fun addToQueue(target: CollectionTarget) = queue(target, QueueAddPosition.END)

    fun toggleStar(target: CollectionTarget, starred: Boolean) {
        val next = !starred
        starredOverrides[target.sourceId] = next
        viewModelScope.launch {
            runCatching {
                val request = when (target.sourceType) {
                    CollectionSource.ARTIST -> StarRequest(artistId = listOf(target.sourceId))
                    else -> StarRequest(albumId = listOf(target.sourceId))
                }
                apiCall {
                    if (next) apiProvider.requireApi().star(request) else apiProvider.requireApi().unstar(request)
                }
            }.onSuccess {
                messages.show(if (next) "Added to favorites" else "Removed from favorites")
            }.onFailure {
                starredOverrides[target.sourceId] = starred
                messages.failure("Couldn't update favorites", it)
            }
        }
    }

    /** Resolves the collection's songs, then hands them to the playlist picker. */
    fun resolveSongIds(target: CollectionTarget, onResolved: (List<String>) -> Unit) {
        viewModelScope.launch {
            runCatching {
                apiCall {
                    apiProvider.requireApi()
                        .sourceSongIds(SourceSongsRequest(sources = listOf(target.toSourceRequest()))).ids
                }
            }.onSuccess(onResolved)
                .onFailure { messages.failure("Couldn't load songs", it) }
        }
    }

    private fun queue(target: CollectionTarget, position: QueueAddPosition) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.addToQueue(QueueAddSpec(sources = listOf(target.toSourceRequest())), position)
            }.onSuccess {
                val name = target.name ?: "Songs"
                messages.show(
                    when (position) {
                        QueueAddPosition.NEXT -> "$name will play next"
                        QueueAddPosition.END -> "$name added to queue"
                    },
                )
            }.onFailure { messages.failure("Couldn't add to queue", it) }
        }
    }

    private fun CollectionTarget.toSourceRequest(): QueueSourceRequest =
        QueueSourceRequest(sourceType = sourceType, sourceId = sourceId)
}

/**
 * Shared action sheet for album/artist/playlist/genre actions, matching the
 * web collection drawer menus: play, shuffle, play next, add to queue, add to
 * playlist, favorite, and "Go to artist". [extraActions] appends screen rows.
 */
@Composable
fun CollectionMenuSheet(
    state: CollectionMenuState,
    extraActions: (CollectionTarget) -> List<MediaAction> = { emptyList() },
    extraContent: (@Composable (CollectionTarget) -> Unit)? = null,
    viewModel: CollectionActionsViewModel = hiltViewModel(),
) {
    val target = state.target ?: return
    val actions = LocalMediaActions.current
    val starred = target.starred?.let { viewModel.starredOverrides[target.sourceId] ?: it }
    MediaActionSheet(
        expanded = true,
        onDismiss = state::close,
        title = target.name,
        subtitle = target.subtitle,
        coverModel = target.coverModel,
        seed = target.name ?: target.sourceId,
        circularCover = target.sourceType == CollectionSource.ARTIST,
        placeholder = collectionIcon(target.sourceType),
        actions = buildList {
            add(MediaAction(label = "Play", icon = Icons.Filled.PlayArrow) { viewModel.play(target) })
            add(MediaAction(label = "Shuffle", icon = Icons.Filled.Shuffle) { viewModel.play(target, shuffle = true) })
            add(MediaAction(label = "Play next", icon = Icons.Filled.PlaylistPlay) { viewModel.playNext(target) })
            add(MediaAction(label = "Add to queue", icon = Icons.Filled.Add) { viewModel.addToQueue(target) })
            add(
                MediaAction(label = "Add to playlist", icon = Icons.AutoMirrored.Filled.PlaylistAdd) {
                    viewModel.resolveSongIds(target, actions::addToPlaylist)
                },
            )
            addAll(extraActions(target))
            if (starred != null) {
                add(
                    MediaAction(
                        label = if (starred) "Remove from favorites" else "Add to favorites",
                        icon = if (starred) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                        separatorBefore = true,
                    ) { viewModel.toggleStar(target, starred) },
                )
            }
            target.artistId?.let { artistId ->
                add(
                    MediaAction(label = "Go to artist", icon = Icons.Filled.Person, separatorBefore = starred == null) {
                        actions.openArtist(artistId)
                    },
                )
            }
        },
        extraContent = extraContent?.let { content -> { content(target) } },
    )
}

private fun collectionIcon(sourceType: String): ImageVector = when (sourceType) {
    CollectionSource.ARTIST -> Icons.Filled.Person
    else -> Icons.Filled.Album
}
