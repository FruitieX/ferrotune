package com.ferrotune.core.actions

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.designsystem.components.MediaActionSeparator
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.ShimmerBox
import com.ferrotune.core.designsystem.components.formatClockDuration
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.generated.SongResponse
import com.ferrotune.core.network.readableMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SongDetailsUiState(
    val song: SongResponse? = null,
    val error: String? = null,
)

@HiltViewModel
class SongDetailsViewModel @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val messages: UserMessages,
) : ViewModel() {
    private val state = MutableStateFlow(SongDetailsUiState())
    val uiState: StateFlow<SongDetailsUiState> = state.asStateFlow()
    private var loadedId: String? = null

    fun copied(label: String) = messages.show("Copied ${label.lowercase()}")

    fun load(songId: String) {
        if (loadedId == songId) return
        loadedId = songId
        state.value = SongDetailsUiState()
        viewModelScope.launch {
            runCatching { apiCall { apiProvider.requireApi().song(songId) }.song }
                .onSuccess { state.value = SongDetailsUiState(song = it) }
                .onFailure { state.value = SongDetailsUiState(error = it.readableMessage() ?: "Couldn't load details") }
        }
    }
}

/** One labelled value in the details sheet (web `DetailRow`). */
data class SongDetailRow(val label: String, val value: String, val copyable: Boolean = false)

/** The web details dialog's rows for a song, skipping values the song doesn't have. */
fun songDetailRows(song: SongResponse, locale: Locale = Locale.getDefault()): List<SongDetailRow> = buildList {
    add(SongDetailRow("Artist", song.artist))
    song.album?.takeIf { it.isNotBlank() }?.let { add(SongDetailRow("Album", it)) }
    song.track?.let { track ->
        add(SongDetailRow("Track", song.discNumber?.takeIf { it > 1 }?.let { "Disc $it, track $track" } ?: "$track"))
    }
    song.year?.let { add(SongDetailRow("Year", "$it")) }
    add(SongDetailRow("Duration", formatClockDuration(song.duration * 1000)))
    song.genre?.takeIf { it.isNotBlank() }?.let { add(SongDetailRow("Genre", it)) }
    add(SongDetailRow("Format", song.suffix.uppercase(locale)))
    song.bitRate?.let { add(SongDetailRow("Bitrate", "$it kbps")) }
    add(SongDetailRow("Size", formatFileSize(song.size)))
    if (song.coverArtWidth != null && song.coverArtHeight != null) {
        add(SongDetailRow("Cover Art", "${song.coverArtWidth} × ${song.coverArtHeight}"))
    }
    formatDetailDate(song.created, locale)?.let { add(SongDetailRow("Added", it)) }
    formatDetailDate(song.starred, locale)?.let { add(SongDetailRow("Favorited", it)) }
    song.userRating?.takeIf { it > 0 }?.let { add(SongDetailRow("Rating", "★".repeat(it) + "☆".repeat(5 - it))) }
    song.playCount?.let { add(SongDetailRow("Play Count", if (it == 1L) "1 play" else "$it plays")) }
    formatDetailDate(song.lastPlayed, locale)?.let { add(SongDetailRow("Last Played", it)) }
    song.originalReplayGainTrackGain?.let { add(SongDetailRow("Original Gain", formatGain(it))) }
    song.originalReplayGainTrackPeak?.let { add(SongDetailRow("Original Peak", "%.6f".format(Locale.ROOT, it))) }
    song.computedReplayGainTrackGain?.let { add(SongDetailRow("Computed Gain", formatGain(it))) }
    song.computedReplayGainTrackPeak?.let { add(SongDetailRow("Computed Peak", "%.6f".format(Locale.ROOT, it))) }
    add(SongDetailRow("Track ID", song.id, copyable = true))
    add(SongDetailRow("File Path", song.fullPath ?: song.path, copyable = true))
}

private fun formatGain(db: Double): String = "${if (db >= 0) "+" else ""}${"%.2f".format(Locale.ROOT, db)} dB"

/** Web `formatFileSize`: binary units with one decimal. */
internal fun formatFileSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return "%.1f %s".format(Locale.ROOT, value, units[unit])
}

/** An ISO-8601 timestamp's date in the long style (minSdk 24 has no java.time). */
internal fun formatDetailDate(iso: String?, locale: Locale = Locale.getDefault()): String? {
    val day = iso?.takeIf { it.length >= 10 }?.substring(0, 10) ?: return null
    val parser = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
        isLenient = false
        timeZone = TimeZone.getTimeZone("UTC")
    }
    val date = runCatching { parser.parse(day) }.getOrNull() ?: return null
    return DateFormat.getDateInstance(DateFormat.LONG, locale).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(date)
}

/**
 * Web "View Details" for a song: a bottom sheet with the cover, title, and
 * the file and listening facts. Long-press the track id or file path to copy it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SongDetailsSheet(
    target: SongMenuTarget,
    onDismiss: () -> Unit,
    viewModel: SongDetailsViewModel = hiltViewModel(key = "song-details"),
) {
    LaunchedEffect(target.id) { viewModel.load(target.id) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val song = state.song?.takeIf { it.id == target.id }
    MediaActionSheet(
        expanded = true,
        onDismiss = onDismiss,
        title = target.title,
        subtitle = "Song details",
        coverModel = target.coverModel,
        seed = target.album ?: target.title,
        placeholder = Icons.Outlined.Info,
        actions = emptyList(),
        extraContent = {
            when {
                song != null -> Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                    songDetailRows(song).forEach { row ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .then(
                                    if (row.copyable) {
                                        Modifier.combinedClickable(
                                            onClick = {},
                                            onLongClick = {
                                                clipboard.setText(AnnotatedString(row.value))
                                                viewModel.copied(row.label)
                                            },
                                        )
                                    } else {
                                        Modifier
                                    },
                                )
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Text(
                                row.label,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.width(112.dp),
                            )
                            Text(
                                row.value,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                maxLines = if (row.copyable) 4 else 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                state.error != null -> Text(
                    state.error!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                )

                else -> Column(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    repeat(6) { ShimmerBox(Modifier.fillMaxWidth().height(18.dp)) }
                }
            }
            MediaActionSeparator()
        },
    )
}
