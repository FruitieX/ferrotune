package com.ferrotune.feature.library.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.inlineCoverModel
import com.ferrotune.core.designsystem.components.CoverArt
import com.ferrotune.core.designsystem.components.EmptyState
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.designsystem.components.LoadingState
import com.ferrotune.core.designsystem.components.MediaRow

@Composable
fun SongRadioScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SongRadioViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.playbackError) {
        state.playbackError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissPlaybackError()
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Song Radio") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        floatingActionButton = {
            if (state.seed != null) {
                ExtendedFloatingActionButton(
                    onClick = { viewModel.play() },
                    icon = { Icon(Icons.Filled.PlayArrow, contentDescription = null) },
                    text = { Text("Play radio") },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        when {
            state.loading -> LoadingState(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.error != null -> ErrorState(
                message = state.error ?: "Failed to load radio",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            )

            state.seed != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                val seed = state.seed!!
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CoverArt(
                        model = inlineCoverModel(seed.coverArtData),
                        contentDescription = seed.title,
                        modifier = Modifier.size(96.dp),
                    )
                    Column {
                        Text(
                            text = "Seed",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(seed.title, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = seed.artist,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    text = "Similar songs",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
                if (state.similar.isEmpty()) {
                    EmptyState("No similar songs available")
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(state.similar, key = { it.id }) { song ->
                            MediaRow(
                                title = song.title,
                                subtitle = listOfNotNull(song.artist, song.album)
                                    .joinToString(" • "),
                                coverModel = inlineCoverModel(song.coverArtData),
                                onClick = { viewModel.play(song.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}
