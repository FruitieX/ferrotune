package com.ferrotune.feature.library.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ferrotune.feature.library.data.LibraryFilters

/** Which fields a view supports (web `DEFAULT_*_FIELDS`). */
enum class FilterScope {
    SONGS,
    ALBUMS,
    ARTISTS,
}

/** [filters] narrowed to the fields [scope] sends to the server. */
fun LibraryFilters.forScope(scope: FilterScope): LibraryFilters = when (scope) {
    FilterScope.SONGS -> this
    FilterScope.ALBUMS -> forAlbums()
    FilterScope.ARTISTS -> forArtists()
}

/**
 * Editable text for each filter field. Numbers and dates are kept as typed
 * and parsed on apply, so a half-typed value never filters the list.
 */
internal data class FilterDraft(
    val minYear: String = "",
    val maxYear: String = "",
    val genre: String = "",
    val minDuration: String = "",
    val maxDuration: String = "",
    val minRating: Int? = null,
    val maxRating: Int? = null,
    val starredOnly: Boolean = false,
    val minPlayCount: String = "",
    val maxPlayCount: String = "",
    val minBitrate: String = "",
    val maxBitrate: String = "",
    val fileFormat: String? = null,
    val addedAfter: String = "",
    val addedBefore: String = "",
    val lastPlayedAfter: String = "",
    val lastPlayedBefore: String = "",
    val missingCoverArt: Boolean = false,
    val shuffleExcludedOnly: Boolean = false,
    val disabledOnly: Boolean = false,
) {
    private val numbers get() = listOf(minYear, maxYear, minDuration, maxDuration, minPlayCount, maxPlayCount, minBitrate, maxBitrate)
    private val dates get() = listOf(addedAfter, addedBefore, lastPlayedAfter, lastPlayedBefore)

    val isValid: Boolean
        get() = numbers.all { isValidNumber(it) } && dates.all { isValidDate(it) }

    fun toFilters(): LibraryFilters = LibraryFilters(
        minYear = minYear.toIntOrNull(),
        maxYear = maxYear.toIntOrNull(),
        genre = genre.trim().ifEmpty { null },
        minDuration = minDuration.toIntOrNull(),
        maxDuration = maxDuration.toIntOrNull(),
        minRating = minRating,
        maxRating = maxRating,
        starredOnly = starredOnly,
        minPlayCount = minPlayCount.toIntOrNull(),
        maxPlayCount = maxPlayCount.toIntOrNull(),
        minBitrate = minBitrate.toIntOrNull(),
        maxBitrate = maxBitrate.toIntOrNull(),
        fileFormat = fileFormat,
        addedAfter = addedAfter.trim().ifEmpty { null },
        addedBefore = addedBefore.trim().ifEmpty { null },
        lastPlayedAfter = lastPlayedAfter.trim().ifEmpty { null },
        lastPlayedBefore = lastPlayedBefore.trim().ifEmpty { null },
        missingCoverArt = missingCoverArt,
        shuffleExcludedOnly = shuffleExcludedOnly,
        disabledOnly = disabledOnly,
    )

    companion object {
        fun from(filters: LibraryFilters) = FilterDraft(
            minYear = filters.minYear?.toString().orEmpty(),
            maxYear = filters.maxYear?.toString().orEmpty(),
            genre = filters.genre.orEmpty(),
            minDuration = filters.minDuration?.toString().orEmpty(),
            maxDuration = filters.maxDuration?.toString().orEmpty(),
            minRating = filters.minRating,
            maxRating = filters.maxRating,
            starredOnly = filters.starredOnly,
            minPlayCount = filters.minPlayCount?.toString().orEmpty(),
            maxPlayCount = filters.maxPlayCount?.toString().orEmpty(),
            minBitrate = filters.minBitrate?.toString().orEmpty(),
            maxBitrate = filters.maxBitrate?.toString().orEmpty(),
            fileFormat = filters.fileFormat,
            addedAfter = filters.addedAfter.orEmpty(),
            addedBefore = filters.addedBefore.orEmpty(),
            lastPlayedAfter = filters.lastPlayedAfter.orEmpty(),
            lastPlayedBefore = filters.lastPlayedBefore.orEmpty(),
            missingCoverArt = filters.missingCoverArt,
            shuffleExcludedOnly = filters.shuffleExcludedOnly,
            disabledOnly = filters.disabledOnly,
        )
    }
}

internal fun isValidNumber(text: String): Boolean = text.isBlank() || text.trim().toIntOrNull()?.let { it >= 0 } == true

private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")

internal fun isValidDate(text: String): Boolean = text.isBlank() || DATE.matches(text.trim())

/**
 * Web advanced filter dialog as a bottom sheet: the fields [scope] supports,
 * applied together with "Apply" or reset with "Clear all".
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AdvancedFiltersSheet(
    filters: LibraryFilters,
    scope: FilterScope,
    genres: List<String>,
    onApply: (LibraryFilters) -> Unit,
    onSaveSmartPlaylist: (name: String, filters: LibraryFilters) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember { mutableStateOf(FilterDraft.from(filters)) }
    var naming by remember { mutableStateOf(false) }
    val savable = draft.isValid && draft.toFilters().forScope(scope).isActive
    val songs = scope == FilterScope.SONGS
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val close = {
        keyboard?.hide()
        onDismiss()
    }
    ModalBottomSheet(
        onDismissRequest = close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        // A full-height sheet would otherwise slide under the status bar.
        modifier = Modifier.statusBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.FilterList, contentDescription = null)
                Text("Advanced filters", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            if (scope != FilterScope.ARTISTS) {
                RangeFields("Year", draft.minYear, draft.maxYear, { draft = draft.copy(minYear = it) }, { draft = draft.copy(maxYear = it) })
                GenreField(draft.genre, genres) { draft = draft.copy(genre = it) }
            }
            RatingChips("Minimum rating (stars)", draft.minRating) { draft = draft.copy(minRating = it) }
            RatingChips("Maximum rating (stars)", draft.maxRating) { draft = draft.copy(maxRating = it) }
            if (songs) {
                RangeFields(
                    "Duration (seconds)",
                    draft.minDuration,
                    draft.maxDuration,
                    { draft = draft.copy(minDuration = it) },
                    { draft = draft.copy(maxDuration = it) },
                )
                RangeFields(
                    "Play count",
                    draft.minPlayCount,
                    draft.maxPlayCount,
                    { draft = draft.copy(minPlayCount = it) },
                    { draft = draft.copy(maxPlayCount = it) },
                )
                RangeFields(
                    "Bitrate (kbps)",
                    draft.minBitrate,
                    draft.maxBitrate,
                    { draft = draft.copy(minBitrate = it) },
                    { draft = draft.copy(maxBitrate = it) },
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FieldLabel("File format")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LibraryFilters.FILE_FORMATS.forEach { (value, label) ->
                            FilterChip(
                                selected = draft.fileFormat == value,
                                onClick = { draft = draft.copy(fileFormat = value.takeUnless { draft.fileFormat == value }) },
                                label = { Text(label) },
                            )
                        }
                    }
                }
                RangeFields(
                    "Date added (YYYY-MM-DD)",
                    draft.addedAfter,
                    draft.addedBefore,
                    { draft = draft.copy(addedAfter = it) },
                    { draft = draft.copy(addedBefore = it) },
                    date = true,
                )
                RangeFields(
                    "Last played (YYYY-MM-DD)",
                    draft.lastPlayedAfter,
                    draft.lastPlayedBefore,
                    { draft = draft.copy(lastPlayedAfter = it) },
                    { draft = draft.copy(lastPlayedBefore = it) },
                    date = true,
                )
            }
            Column {
                SwitchField("Favorites only", draft.starredOnly) { draft = draft.copy(starredOnly = it) }
                if (songs) {
                    SwitchField("Missing cover art", draft.missingCoverArt) { draft = draft.copy(missingCoverArt = it) }
                    SwitchField("Disabled tracks only", draft.disabledOnly) { draft = draft.copy(disabledOnly = it) }
                    SwitchField("Shuffle-excluded only", draft.shuffleExcludedOnly) {
                        draft = draft.copy(shuffleExcludedOnly = it)
                    }
                }
            }
            if (savable) {
                OutlinedButton(
                    onClick = {
                        // Otherwise the sheet scrolls back to the focused field when the dialog closes.
                        focusManager.clearFocus()
                        naming = true
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Save as smart playlist")
                }
            }
            Row(modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { draft = FilterDraft() }) { Text("Clear all") }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = close) { Text("Cancel") }
                Button(
                    onClick = {
                        onApply(draft.toFilters().forScope(scope).merged(filters, scope))
                        close()
                    },
                    enabled = draft.isValid,
                ) { Text("Apply") }
            }
        }
    }
    if (naming) {
        SmartPlaylistNameDialog(
            onSave = { name ->
                onSaveSmartPlaylist(name, draft.toFilters().forScope(scope))
                naming = false
            },
            onDismiss = { naming = false },
        )
    }
}

/** Web `SmartPlaylistNameDialog`: names the smart playlist saved from the filters. */
@Composable
private fun SmartPlaylistNameDialog(onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Filled.AutoAwesome, contentDescription = null) },
        title = { Text("Save as smart playlist") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { onSave(name.trim()) }, enabled = name.isNotBlank()) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Keeps filters the [scope] can't show (e.g. a song-only bitrate set on the
 * Songs tab) when applying from a narrower tab, like the shared web atom.
 */
private fun LibraryFilters.merged(previous: LibraryFilters, scope: FilterScope): LibraryFilters = when (scope) {
    FilterScope.SONGS -> this
    FilterScope.ALBUMS -> previous.copy(
        minYear = minYear,
        maxYear = maxYear,
        genre = genre,
        minRating = minRating,
        maxRating = maxRating,
        starredOnly = starredOnly,
    )
    FilterScope.ARTISTS -> previous.copy(minRating = minRating, maxRating = maxRating, starredOnly = starredOnly)
}

/** Removable chips for the active filters below the library tabs (web `ActiveFilterBadges`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveFilterChips(
    filters: LibraryFilters,
    scope: FilterScope,
    onChange: (LibraryFilters) -> Unit,
    onEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val badges = filters.forScope(scope).badges()
    if (badges.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InputChip(
            selected = true,
            onClick = onEdit,
            label = { Text("Filters") },
            leadingIcon = { Icon(Icons.Filled.FilterList, contentDescription = null, modifier = Modifier.size(18.dp)) },
        )
        badges.forEach { badge ->
            // Clearing a badge keeps the filters other tabs use.
            InputChip(
                selected = false,
                onClick = { onChange(badge.without.forScope(scope).merged(filters, scope)) },
                label = { Text(badge.label) },
                trailingIcon = { Icon(Icons.Filled.Close, contentDescription = "Remove ${badge.label}", modifier = Modifier.size(16.dp)) },
            )
        }
        TextButton(onClick = { onChange(LibraryFilters.NONE.merged(filters, scope)) }) { Text("Clear") }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun RangeFields(
    label: String,
    min: String,
    max: String,
    onMin: (String) -> Unit,
    onMax: (String) -> Unit,
    date: Boolean = false,
) {
    val valid: (String) -> Boolean = if (date) ::isValidDate else ::isValidNumber
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FieldLabel(label)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = min,
                onValueChange = onMin,
                placeholder = { Text(if (date) "After" else "Min") },
                singleLine = true,
                isError = !valid(min),
                keyboardOptions = KeyboardOptions(keyboardType = if (date) KeyboardType.Text else KeyboardType.Number),
                modifier = Modifier.weight(1f),
            )
            Text("–")
            OutlinedTextField(
                value = max,
                onValueChange = onMax,
                placeholder = { Text(if (date) "Before" else "Max") },
                singleLine = true,
                isError = !valid(max),
                keyboardOptions = KeyboardOptions(keyboardType = if (date) KeyboardType.Text else KeyboardType.Number),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GenreField(value: String, genres: List<String>, onChange: (String) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val matches = genres.filter { value.isBlank() || it.contains(value.trim(), ignoreCase = true) }.take(8)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FieldLabel("Genre")
        ExposedDropdownMenuBox(expanded = expanded && matches.isNotEmpty(), onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = value,
                onValueChange = {
                    onChange(it)
                    expanded = true
                },
                placeholder = { Text("Any genre") },
                singleLine = true,
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded && matches.isNotEmpty()) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(MenuAnchorType.PrimaryEditable),
            )
            ExposedDropdownMenu(expanded = expanded && matches.isNotEmpty(), onDismissRequest = { expanded = false }) {
                matches.forEach { genre ->
                    DropdownMenuItem(
                        text = { Text(genre) },
                        onClick = {
                            onChange(genre)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RatingChips(label: String, value: Int?, onChange: (Int?) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FieldLabel(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(selected = value == null, onClick = { onChange(null) }, label = { Text("Any") })
            (1..5).forEach { stars ->
                FilterChip(selected = value == stars, onClick = { onChange(stars) }, label = { Text("$stars") })
            }
        }
    }
}

@Composable
private fun SwitchField(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
