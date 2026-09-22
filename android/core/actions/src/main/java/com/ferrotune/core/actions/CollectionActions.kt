package com.ferrotune.core.actions

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.designsystem.components.MediaAction
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.QueueAddPosition
import com.ferrotune.core.media.QueueAddSpec
import com.ferrotune.core.media.QueueStartSpec
import com.ferrotune.core.network.generated.QueueSourceRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

/** Queue source descriptors for the collection menus. */
object CollectionSource {
    const val ALBUM = "album"
    const val ARTIST = "artist"
    const val PLAYLIST = "playlist"
    const val SMART_PLAYLIST = "smartPlaylist"
}

/** One album/artist/playlist target for [CollectionActionSheet]. */
data class CollectionTarget(
    val sourceType: String,
    val sourceId: String,
    val name: String? = null,
)

/** Playback mutations backing the shared collection menus. */
@HiltViewModel
class CollectionActionsViewModel @Inject constructor(
    private val playbackStarter: PlaybackStarter,
) : ViewModel() {

    fun play(target: CollectionTarget) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.startQueue(
                    QueueStartSpec(
                        sourceType = target.sourceType,
                        sourceId = target.sourceId,
                        sourceName = target.name,
                    ),
                )
            }
        }
    }

    fun shuffle(target: CollectionTarget) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.startQueue(
                    QueueStartSpec(
                        sourceType = target.sourceType,
                        sourceId = target.sourceId,
                        sourceName = target.name,
                        shuffle = true,
                    ),
                )
            }
        }
    }

    fun playNext(target: CollectionTarget) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.addToQueue(
                    QueueAddSpec(sources = listOf(target.toSourceRequest())),
                    QueueAddPosition.NEXT,
                )
            }
        }
    }

    fun addToQueue(target: CollectionTarget) {
        viewModelScope.launch {
            runCatching {
                playbackStarter.addToQueue(
                    QueueAddSpec(sources = listOf(target.toSourceRequest())),
                    QueueAddPosition.END,
                )
            }
        }
    }

    private fun CollectionTarget.toSourceRequest(): QueueSourceRequest =
        QueueSourceRequest(sourceType = sourceType, sourceId = sourceId)
}

/**
 * Shared action sheet for album/artist/playlist actions: play, shuffle, play
 * next, add to queue, and an optional "Go to artist". Features append their
 * own rows via [extraContent].
 */
@Composable
fun CollectionActionSheet(
    expanded: Boolean,
    onDismiss: () -> Unit,
    target: CollectionTarget,
    title: String? = null,
    subtitle: String? = null,
    coverModel: Any? = null,
    onGoToArtist: (() -> Unit)? = null,
    extraContent: (@Composable () -> Unit)? = null,
    viewModel: CollectionActionsViewModel = hiltViewModel(),
) {
    MediaActionSheet(
        expanded = expanded,
        onDismiss = onDismiss,
        title = title,
        subtitle = subtitle,
        coverModel = coverModel,
        seed = target.sourceId,
        actions = buildList {
            add(MediaAction(label = "Play", icon = Icons.Filled.PlayArrow) { viewModel.play(target) })
            add(MediaAction(label = "Shuffle", icon = Icons.Filled.Shuffle) { viewModel.shuffle(target) })
            add(
                MediaAction(label = "Play next", icon = Icons.Filled.PlaylistPlay) {
                    viewModel.playNext(target)
                },
            )
            add(
                MediaAction(label = "Add to queue", icon = Icons.Filled.Add) {
                    viewModel.addToQueue(target)
                },
            )
            onGoToArtist?.let {
                add(MediaAction(label = "Go to artist", icon = Icons.Filled.Person, onClick = it))
            }
        },
        extraContent = extraContent,
    )
}
