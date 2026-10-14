package com.ferrotune.core.actions

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LibraryAdd
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.Checkbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.HeartPlusIcon
import com.ferrotune.core.designsystem.components.MediaActionRow
import com.ferrotune.core.designsystem.components.MediaActionSeparator
import com.ferrotune.core.designsystem.components.MediaActionSheet
import com.ferrotune.core.designsystem.components.TrackListHeader
import com.ferrotune.core.network.SongColumn
import com.ferrotune.core.network.SongColumnsPreferencesRepository
import com.ferrotune.core.network.SongListView
import com.ferrotune.core.network.generated.SongResponse
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.launch

/** What song rows show unless a screen or the user says otherwise. */
val DefaultSongColumns: Set<SongColumn> = setOf(
    SongColumn.INDEX,
    SongColumn.COVER,
    SongColumn.ARTIST,
    SongColumn.ALBUM,
    SongColumn.DURATION,
)

/** One screen's visible song columns and the picker that changes them. */
@Stable
class SongColumnsState internal constructor(
    val view: SongListView,
    val defaults: Set<SongColumn>,
    private val storedColumns: State<Map<SongListView, Set<SongColumn>>>,
    private val repository: SongColumnsPreferencesRepository,
    private val launch: (suspend () -> Unit) -> Unit,
) {
    private val stored: Set<SongColumn>? get() = storedColumns.value[view]

    var pickerOpen by mutableStateOf(false)
        private set

    val visible: Set<SongColumn> get() = stored ?: defaults

    val isCustomized: Boolean get() = stored != null

    fun openPicker() {
        pickerOpen = true
    }

    fun closePicker() {
        pickerOpen = false
    }

    fun toggle(column: SongColumn) {
        val updated = if (column in visible) visible - column else visible + column
        // ServerPreferences applies the write optimistically.
        launch { repository.setColumns(view, updated) }
    }

    fun reset() {
        launch { repository.reset(view) }
    }
}

/**
 * The visible song columns for [view], server-synced per view. Place
 * [SongColumnsSheet] once on the screen and [SongColumnsMenuRow] in its ⋯ sheet.
 */
@Composable
fun rememberSongColumnsState(
    view: SongListView,
    defaults: Set<SongColumn> = DefaultSongColumns,
): SongColumnsState {
    val context = LocalContext.current
    val repository = remember(context) { songActionsEntryPoint(context).songColumnsRepository() }
    val scope = rememberCoroutineScope()
    val stored = repository.columns.collectAsStateWithLifecycle()
    LaunchedEffect(repository) { repository.ensureLoaded() }
    return remember(view, defaults, repository) {
        SongColumnsState(view, defaults, stored, repository) { block -> scope.launch { block() } }
    }
}

/** The "# Title Time" header, following the chosen columns. */
@Composable
fun SongColumnsHeader(state: SongColumnsState, showIndex: Boolean = true) {
    TrackListHeader(
        showIndex = showIndex && SongColumn.INDEX in state.visible,
        showTime = SongColumn.DURATION in state.visible,
    )
}

/** "Columns" row for a screen's ⋯ sheet; opens the picker. */
@Composable
fun SongColumnsMenuRow(state: SongColumnsState) {
    MediaActionRow(
        icon = Icons.Filled.ViewColumn,
        label = "Columns",
        onClick = state::openPicker,
    )
}

/** Checklist of song columns for the screen's listing. */
@Composable
fun SongColumnsSheet(state: SongColumnsState) {
    MediaActionSheet(
        expanded = state.pickerOpen,
        onDismiss = state::closePicker,
        actions = emptyList(),
        title = "Columns",
        subtitle = "Choose what song rows show",
        extraContent = {
            SongColumn.entries.forEach { column ->
                MediaActionRow(
                    icon = column.icon,
                    label = column.label,
                    onClick = { state.toggle(column) },
                    closesSheet = false,
                    trailing = { Checkbox(checked = column in state.visible, onCheckedChange = null) },
                )
            }
            if (state.isCustomized) {
                MediaActionSeparator()
                MediaActionRow(
                    icon = Icons.Outlined.RestartAlt,
                    label = "Reset to default",
                    onClick = state::reset,
                    closesSheet = false,
                )
            }
        },
    )
}

/**
 * The quieter third line of a song row: the enabled columns that don't fit
 * the subtitle, e.g. "2019 • Rock • 12 plays • ★ 4 • OPUS 128 kbps".
 */
fun songColumnDetails(
    song: SongResponse,
    columns: Set<SongColumn>,
    locale: Locale = Locale.getDefault(),
    /** The current like count (after a like tap), else the song's. */
    likeCount: Int = song.likeCount?.toInt() ?: 0,
): String? = buildList {
    if (SongColumn.YEAR in columns) song.year?.takeIf { it > 0 }?.let { add(it.toString()) }
    if (SongColumn.GENRE in columns) song.genre?.takeIf { it.isNotBlank() }?.let(::add)
    if (SongColumn.PLAY_COUNT in columns) {
        val plays = song.playCount ?: 0
        add(if (plays == 1L) "1 play" else "$plays plays")
    }
    if (SongColumn.LIKES in columns) add(if (likeCount == 1) "1 like" else "$likeCount likes")
    if (SongColumn.RATING in columns) song.userRating?.takeIf { it > 0 }?.let { add("★ $it") }
    if (SongColumn.FORMAT in columns) {
        add(listOfNotNull(song.suffix.uppercase(locale).ifBlank { null }, song.bitRate?.let { "$it kbps" }).joinToString(" "))
    }
    if (SongColumn.DATE_ADDED in columns) shortDate(song.created, locale)?.let { add("Added $it") }
    if (SongColumn.LAST_PLAYED in columns) shortDate(song.lastPlayed, locale)?.let { add("Played $it") }
}.filter { it.isNotBlank() }.joinToString(" • ").ifEmpty { null }

/** An ISO-8601 timestamp's day in the medium style ("Oct 3, 2026"). */
internal fun shortDate(iso: String?, locale: Locale): String? {
    val day = iso?.takeIf { it.length >= 10 }?.substring(0, 10) ?: return null
    val utc = TimeZone.getTimeZone("UTC")
    val date = runCatching {
        SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
            isLenient = false
            timeZone = utc
        }.parse(day)
    }.getOrNull() ?: return null
    return DateFormat.getDateInstance(DateFormat.MEDIUM, locale).apply { timeZone = utc }.format(date)
}

private val SongColumn.icon
    get() = when (this) {
        SongColumn.INDEX -> Icons.Filled.FormatListNumbered
        SongColumn.COVER -> Icons.Filled.Image
        SongColumn.ARTIST -> Icons.Filled.Person
        SongColumn.ALBUM -> Icons.Filled.Album
        SongColumn.DURATION -> Icons.Filled.Schedule
        SongColumn.FAVORITE -> Icons.Filled.Favorite
        SongColumn.YEAR -> Icons.Filled.CalendarMonth
        SongColumn.GENRE -> Icons.Filled.Category
        SongColumn.PLAY_COUNT -> Icons.Filled.BarChart
        SongColumn.LIKES -> HeartPlusIcon
        SongColumn.RATING -> Icons.Filled.Star
        SongColumn.FORMAT -> Icons.Filled.GraphicEq
        SongColumn.DATE_ADDED -> Icons.Filled.LibraryAdd
        SongColumn.LAST_PLAYED -> Icons.Filled.History
    }
