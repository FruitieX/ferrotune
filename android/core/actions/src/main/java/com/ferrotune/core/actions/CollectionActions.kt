package com.ferrotune.core.actions

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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

/** One album/artist/playlist target for [CollectionMenuItems]. */
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
 * Shared dropdown items for album/artist/playlist actions: play, shuffle,
 * play next, add to queue, and an optional "Go to artist". Features append
 * their own items via [extraItems].
 */
@Composable
fun CollectionMenuItems(
    target: CollectionTarget,
    onDismiss: () -> Unit,
    onGoToArtist: (() -> Unit)? = null,
    extraItems: (@Composable () -> Unit)? = null,
    viewModel: CollectionActionsViewModel = hiltViewModel(),
) {
    DropdownMenuItem(
        text = { Text("Play") },
        leadingIcon = { Icon(Icons.Filled.PlayArrow, contentDescription = null) },
        onClick = {
            onDismiss()
            viewModel.play(target)
        },
    )
    DropdownMenuItem(
        text = { Text("Shuffle") },
        leadingIcon = { Icon(Icons.Filled.Shuffle, contentDescription = null) },
        onClick = {
            onDismiss()
            viewModel.shuffle(target)
        },
    )
    DropdownMenuItem(
        text = { Text("Play next") },
        leadingIcon = { Icon(Icons.Filled.PlaylistPlay, contentDescription = null) },
        onClick = {
            onDismiss()
            viewModel.playNext(target)
        },
    )
    DropdownMenuItem(
        text = { Text("Add to queue") },
        leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
        onClick = {
            onDismiss()
            viewModel.addToQueue(target)
        },
    )
    if (onGoToArtist != null) {
        DropdownMenuItem(
            text = { Text("Go to artist") },
            leadingIcon = { Icon(Icons.Filled.Person, contentDescription = null) },
            onClick = {
                onDismiss()
                onGoToArtist()
            },
        )
    }
    extraItems?.invoke()
}
