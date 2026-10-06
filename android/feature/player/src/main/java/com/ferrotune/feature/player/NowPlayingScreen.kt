package com.ferrotune.feature.player

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.CastConnected
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.ferrotune.core.actions.LocalMediaActions
import com.ferrotune.core.actions.SongActionsViewModel
import com.ferrotune.core.actions.SongMenuSheet
import com.ferrotune.core.actions.SongMenuTarget
import com.ferrotune.core.actions.closingBeforeNavigation
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.actions.rememberSongMenuState
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.FavoriteButton
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.theme.LocalDarkTheme
import com.ferrotune.core.media.TrackInfo
import kotlin.math.abs

private val ART_GAP = 16.dp

/**
 * Web fullscreen player: blurred-cover background, "Playing from <source>"
 * header with the song's ⋯ menu, swipeable artwork, left-aligned title and
 * artist with the favorite heart, seek bar, transport controls, and a bottom
 * row with Cast and the "Queue" pill.
 */
@Composable
fun NowPlayingScreen(
    onBack: () -> Unit,
    sheetState: NowPlayingSheetState,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val progress by viewModel.progress.collectAsStateWithLifecycle()
    val queuePanel = LocalQueuePanel.current
    val songMenu = rememberSongMenuState()
    val haptics = LocalHapticFeedback.current
    val track = state.track
    val appActions = LocalMediaActions.current
    // Navigating from the player ("Go to album", song radio, ...) closes it first.
    val actions = remember(appActions, onBack) { appActions.closingBeforeNavigation(onBack) }

    CompositionLocalProvider(LocalMediaActions provides actions) {
        Surface(
            modifier = modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                NowPlayingBackground(track)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .windowInsetsPadding(WindowInsets.safeDrawing)
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                ) {
                    Header(
                        sourceName = state.sourceName,
                        sourceType = state.sourceType,
                        castDevice = state.cast.deviceName.takeIf { state.cast.isConnected },
                        onClose = onBack,
                        onMore = { track?.let { songMenu.open(it.toMenuTarget()) } },
                    )
                    SwipeableArtwork(
                        track = track,
                        previousTrack = state.previousTrack,
                        nextTrack = state.nextTrack,
                        offsetX = sheetState.artOffsetX,
                        onDistanceChanged = { sheetState.artDistancePx = it },
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(vertical = 20.dp),
                    )
                    TitleRow(track = track, onOpenArtist = { track?.artistId?.let(actions::openArtist) })
                    Spacer(Modifier.height(20.dp))
                    state.error?.let { message ->
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }
                    PlayerSeekBar(
                        progress = progress,
                        showWaveform = state.showsWaveform,
                        waveform = state.waveform,
                        onSeek = viewModel::seekToFraction,
                    )
                    Spacer(Modifier.height(16.dp))
                    TransportControls(
                        state = state,
                        onShuffle = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            viewModel.toggleShuffle()
                        },
                        onPrevious = { viewModel.previous() },
                        onPlayPause = viewModel::togglePlayPause,
                        onNext = viewModel::next,
                        onRepeat = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            viewModel.cycleRepeat()
                        },
                    )
                    Spacer(Modifier.height(20.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (state.cast.isConnected) {
                            IconButton(onClick = viewModel::disconnectCast) {
                                Icon(
                                    Icons.Filled.CastConnected,
                                    contentDescription = "Disconnect Cast",
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        } else if (state.cast.available) {
                            CastRouteButton()
                        }
                        Spacer(Modifier.weight(1f))
                        // Web shadcn `outline` button: foreground text on an `--input` border and fill.
                        val input = MaterialTheme.colorScheme.outlineVariant
                        OutlinedButton(
                            onClick = { queuePanel.open() },
                            shape = CircleShape,
                            border = BorderStroke(1.dp, input),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (LocalDarkTheme.current) input.copy(alpha = 0.3f) else MaterialTheme.colorScheme.background,
                                contentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.QueueMusic,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Text("Queue", modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }

        SongMenuSheet(state = songMenu)
    }
}


internal fun TrackInfo.toMenuTarget() = SongMenuTarget(
    id = id,
    title = title,
    artist = artist,
    artistId = artistId,
    album = album.takeIf { it.isNotBlank() },
    albumId = albumId,
    coverModel = inlineCoverModel(coverArtData) ?: coverArtUrl,
    starred = starred != null,
    rating = 0,
)

/**
 * Web `FullscreenBackground`: the cover, heavily blurred under a 70%
 * background wash (a plain wash before Android 12, which can't blur).
 */
@Composable
private fun NowPlayingBackground(track: TrackInfo?) {
    val model = inlineCoverModel(track?.coverArtData) ?: track?.coverArtUrl
    if (model != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        AsyncImage(
            model = model,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .blur(64.dp),
        )
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.7f)),
    )
}

@Composable
private fun Header(
    sourceName: String?,
    sourceType: String?,
    castDevice: String?,
    onClose: () -> Unit,
    onMore: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClose) {
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = "Close now playing",
                modifier = Modifier.size(28.dp),
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = if (castDevice != null) "PLAYING ON" else "PLAYING FROM",
                style = MaterialTheme.typography.labelSmall,
                letterSpacing = MaterialTheme.typography.labelSmall.letterSpacing * 1.5f,
                color = if (castDevice != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = castDevice ?: sourceName ?: if (sourceType == "library") "Library" else "Queue",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onMore) {
            Icon(Icons.Filled.MoreHoriz, contentDescription = "More options")
        }
    }
}

@Composable
private fun TitleRow(track: TrackInfo?, onOpenArtist: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = track?.title ?: "Nothing playing",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = track?.artist.orEmpty(),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(enabled = track?.artistId != null, onClick = onOpenArtist),
            )
        }
        if (track != null) {
            val flags = rememberSongFlags(songId = track.id, starred = track.starred != null)
            val songActions: SongActionsViewModel = hiltViewModel()
            FavoriteButton(
                isFavorite = flags.starred,
                onToggle = { songActions.toggleStar(track.id, flags) },
                iconSize = 26.dp,
            )
        }
    }
}

@Composable
private fun TransportControls(
    state: PlayerUiState,
    onShuffle: () -> Unit,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    onRepeat: () -> Unit,
) {
    val active = MaterialTheme.colorScheme.primary
    val inactive = MaterialTheme.colorScheme.onSurface
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        IconButton(onClick = onShuffle) {
            Icon(
                Icons.Filled.Shuffle,
                contentDescription = if (state.isShuffled) "Shuffle on" else "Shuffle off",
                tint = if (state.isShuffled) active else inactive,
            )
        }
        IconButton(onClick = onPrevious, modifier = Modifier.size(56.dp)) {
            Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous track", modifier = Modifier.size(34.dp))
        }
        FilledIconButton(
            onClick = onPlayPause,
            shape = CircleShape,
            modifier = Modifier.size(68.dp),
        ) {
            if (state.isBuffering) {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 3.dp,
                )
            } else {
                Icon(
                    imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (state.isPlaying) "Pause" else "Play",
                    modifier = Modifier.size(36.dp),
                )
            }
        }
        IconButton(onClick = onNext, modifier = Modifier.size(56.dp)) {
            Icon(Icons.Filled.SkipNext, contentDescription = "Next track", modifier = Modifier.size(34.dp))
        }
        IconButton(onClick = onRepeat) {
            Icon(
                imageVector = if (state.repeatMode == "one") Icons.Filled.RepeatOne else Icons.Filled.Repeat,
                contentDescription = "Repeat ${state.repeatMode}",
                tint = if (state.repeatMode == "off") inactive else active,
            )
        }
    }
}

/**
 * Album artwork that follows horizontal swipes, revealing the adjacent track's
 * artwork in the swipe direction. Uses the full-size cover with the inline
 * thumbnail underneath while it loads.
 */
@Composable
private fun SwipeableArtwork(
    track: TrackInfo?,
    previousTrack: TrackInfo?,
    nextTrack: TrackInfo?,
    offsetX: Float,
    onDistanceChanged: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val gapPx = with(LocalDensity.current) { ART_GAP.toPx() }
    var widthPx by remember { mutableIntStateOf(0) }
    val distancePx = (widthPx + gapPx)
    val progress = if (distancePx > 0f) (abs(offsetX) / distancePx).coerceIn(0f, 1f) else 0f

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .widthIn(max = 600.dp)
                .aspectRatio(1f, matchHeightConstraintsFirst = true)
                .onSizeChanged {
                    widthPx = it.width
                    onDistanceChanged(it.width + gapPx)
                },
        ) {
            if (offsetX > 0f && previousTrack != null) {
                Artwork(previousTrack, translationX = offsetX - distancePx, alpha = progress, scale = 0.92f + 0.08f * progress)
            }
            if (offsetX < 0f && nextTrack != null) {
                Artwork(nextTrack, translationX = offsetX + distancePx, alpha = progress, scale = 0.92f + 0.08f * progress)
            }
            Artwork(
                track,
                translationX = offsetX,
                alpha = 1f - 0.7f * progress,
                scale = 1f - 0.04f * progress,
                elevated = true,
            )
        }
    }
}

@Composable
private fun Artwork(
    track: TrackInfo?,
    translationX: Float,
    alpha: Float,
    scale: Float,
    elevated: Boolean = false,
) {
    val shape = RoundedCornerShape(8.dp)
    CoverArt(
        model = track?.coverArtUrl,
        fallbackModel = inlineCoverModel(track?.coverArtData),
        contentDescription = track?.album,
        seed = track?.album ?: track?.title,
        shape = shape,
        iconFraction = 0.3f,
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.translationX = translationX
                this.alpha = alpha
                scaleX = scale
                scaleY = scale
            }
            .then(if (elevated) Modifier.shadow(24.dp, shape) else Modifier),
    )
}
