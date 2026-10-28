package com.ferrotune.core.actions

import com.ferrotune.core.media.PlaybackEvent
import com.ferrotune.core.media.PlaybackRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the media notification's favorite button in step with the app.
 *
 * The button shows the current track's favorite state as every screen sees
 * it (server value plus [SongFlagsStore]'s pending changes), and a tap on it
 * goes through the same store, so it reaches the server and every screen.
 */
@Singleton
class NowPlayingFavoriteSync @Inject constructor(
    private val playback: PlaybackRepository,
    private val store: SongFlagsStore,
    private val messages: UserMessages,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var started = false

    fun start() {
        if (started) return
        started = true

        scope.launch {
            combine(
                playback.state.map { it.track }.distinctUntilChanged(),
                store.overrides,
            ) { track, overrides ->
                track?.let { current ->
                    val base = SongFlags(starred = current.starred != null)
                    current.id to (overrides[current.id]?.mergedWith(base) ?: base).starred
                }
            }
                .distinctUntilChanged()
                .collect { trackStarred ->
                    // A track is only set while the service runs, so this never
                    // starts the service by itself.
                    trackStarred?.let { (_, starred) -> playback.updateStarredState(starred) }
                }
        }

        scope.launch {
            playback.events.filterIsInstance<PlaybackEvent.StarToggled>().collect { event ->
                // The service already flipped its button; isStarred is the state
                // before the tap.
                runCatching {
                    store.setStarred(
                        songId = event.trackId,
                        starred = !event.isStarred,
                        base = SongFlags(starred = event.isStarred),
                    )
                }.onFailure { messages.failure("Couldn't update favorites", it) }
            }
        }
    }
}
