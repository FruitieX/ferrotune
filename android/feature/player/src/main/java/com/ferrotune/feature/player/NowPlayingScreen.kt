package com.ferrotune.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CastConnected
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.actions.SongFavoriteButton
import com.ferrotune.core.actions.rememberSongFlags
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.WaveformBar
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.theme.seedGradient

@Composable
fun NowPlayingScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var queueOpen by remember { mutableStateOf(false) }
    val darkTheme = isSystemInDarkTheme()
    val backdrop = seedGradient(state.track?.id ?: state.track?.title, darkTheme)

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .background(
                Brush.verticalGradient(
                    listOf(
                        backdrop.glow.copy(alpha = if (darkTheme) 0.28f else 0.45f),
                        backdrop.end.copy(alpha = if (darkTheme) 0.12f else 0.22f),
                        Color.Transparent,
                    ),
                ),
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.Filled.KeyboardArrowDown,
                    contentDescription = "Close now playing",
                )
            }
            Column {
                Text(
                    text = "Now Playing",
                    style = MaterialTheme.typography.titleMedium,
                )
                if (state.cast.isConnected) {
                    Text(
                        text = "Casting to ${state.cast.deviceName ?: "device"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            if (state.cast.isConnected) {
                IconButton(onClick = viewModel::disconnectCast) {
                    Icon(
                        Icons.Filled.CastConnected,
                        contentDescription = "Disconnect Cast",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            } else if (state.cast.available) {
                CastRouteButton(modifier = Modifier.padding(horizontal = 4.dp))
            }
            IconButton(onClick = { queueOpen = true }) {
                Icon(
                    Icons.AutoMirrored.Filled.QueueMusic,
                    contentDescription = "Queue",
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        CoverArt(
            model = inlineCoverModel(state.track?.coverArtData) ?: state.track?.coverArtUrl,
            contentDescription = state.track?.album,
            seed = state.track?.id,
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .shadow(16.dp, RoundedCornerShape(20.dp)),
        )

        Spacer(Modifier.weight(1f))

        Text(
            text = state.track?.title ?: "Nothing playing",
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = state.track?.artist.orEmpty(),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.track?.album?.takeIf { it.isNotBlank() }?.let { album ->
            Spacer(Modifier.height(4.dp))
            Text(
                text = album,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        state.track?.let { track ->
            val flags = rememberSongFlags(
                songId = track.id,
                starred = track.starred != null,
            )
            Spacer(Modifier.height(12.dp))
            SongFavoriteButton(songId = track.id, flags = flags, iconSize = 26.dp)
        }

        Spacer(Modifier.weight(1f))

        state.error?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))
        }

        if (state.progressBarStyle == "waveform" && state.waveformHeights.isNotEmpty()) {
            WaveformBar(
                heights = state.waveformHeights,
                progress = state.progressFraction,
                onSeek = viewModel::seekToFraction,
                height = 40.dp,
                barWidth = 3.dp,
                barGap = 2.dp,
            )
        } else {
            Slider(
                value = state.progressFraction,
                onValueChange = viewModel::seekToFraction,
                enabled = state.durationMs > 0,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatDuration(state.positionMs), style = MaterialTheme.typography.labelSmall)
            Text(formatDuration(state.durationMs), style = MaterialTheme.typography.labelSmall)
        }

        Spacer(Modifier.height(8.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            IconButton(onClick = viewModel::toggleShuffle) {
                Icon(
                    Icons.Filled.Shuffle,
                    contentDescription = "Shuffle",
                    tint = if (state.isShuffled) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            IconButton(onClick = viewModel::previous) {
                Icon(
                    Icons.Filled.SkipPrevious,
                    contentDescription = "Previous track",
                    modifier = Modifier.size(40.dp),
                )
            }
            FilledIconButton(
                onClick = viewModel::togglePlayPause,
                shape = CircleShape,
                modifier = Modifier
                    .padding(horizontal = 8.dp)
                    .size(68.dp),
            ) {
                if (state.isBuffering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(30.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (state.isPlaying) "Pause" else "Play",
                        modifier = Modifier.size(38.dp),
                    )
                }
            }
            IconButton(onClick = viewModel::next) {
                Icon(
                    Icons.Filled.SkipNext,
                    contentDescription = "Next track",
                    modifier = Modifier.size(40.dp),
                )
            }
            IconButton(onClick = viewModel::cycleRepeat) {
                Icon(
                    imageVector = if (state.repeatMode == "one") {
                        Icons.Filled.RepeatOne
                    } else {
                        Icons.Filled.Repeat
                    },
                    contentDescription = "Repeat ${state.repeatMode}",
                    tint = if (state.repeatMode == "off") {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        }
    }

    if (queueOpen) {
        QueueSheet(onDismiss = { queueOpen = false })
    }
}

private fun formatDuration(durationMs: Long): String {
    if (durationMs <= 0) return "0:00"
    val totalSeconds = durationMs / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}
