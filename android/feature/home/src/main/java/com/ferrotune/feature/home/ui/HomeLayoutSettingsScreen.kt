package com.ferrotune.feature.home.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.ErrorState
import com.ferrotune.core.model.Account
import com.ferrotune.feature.home.data.HomePlaylistChoice
import com.ferrotune.feature.home.data.HomeSectionConfig
import com.ferrotune.feature.home.data.HomeSectionKind
import com.ferrotune.feature.home.data.HomeTileActionMode
import com.ferrotune.feature.home.data.HomeTileConfig
import com.ferrotune.feature.home.data.HomeTileKind
import com.ferrotune.feature.home.data.createHomeTile
import com.ferrotune.feature.home.data.createPlaylistHomeSection
import com.ferrotune.feature.home.data.defaultHomeTileAction
import com.ferrotune.feature.home.data.supportedHomeTileActions
import kotlin.math.max

@Composable
fun HomeLayoutSettingsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeLayoutSettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var editingTile by remember { mutableStateOf<HomeTileConfig?>(null) }
    var editingSection by remember { mutableStateOf<HomeSectionConfig?>(null) }
    var newTileKind by remember { mutableStateOf(HomeTileKind.FORGOTTEN_FAVORITES) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissMessage()
        }
    }

    editingTile?.let { tile ->
        HomeTileEditDialog(
            tile = tile,
            sections = state.sections,
            playlistChoices = state.playlistChoices,
            accounts = state.accounts,
            onSave = { updated ->
                viewModel.updateTile(updated)
                editingTile = null
            },
            onDismiss = { editingTile = null },
        )
    }

    editingSection?.let { section ->
        HomeSectionEditDialog(
            section = section,
            playlistChoices = state.playlistChoices,
            onSave = { updated ->
                viewModel.updateSection(updated)
                editingSection = null
            },
            onDismiss = { editingSection = null },
        )
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Home") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            state.error != null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                ErrorState(message = state.error!!, onRetry = viewModel::load)
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                item {
                    SettingsHeader(
                        title = "Home Tiles",
                        description = "Choose the quick actions shown at the top of Home",
                    )
                }
                itemsIndexed(state.tiles, key = { _, tile -> tile.id }) { index, tile ->
                    HomeTileRow(
                        tile = tile,
                        sections = state.sections,
                        canMoveUp = index > 0,
                        canMoveDown = index < state.tiles.lastIndex,
                        onEdit = { editingTile = tile },
                        onMoveUp = { viewModel.moveTile(tile.id, -1) },
                        onMoveDown = { viewModel.moveTile(tile.id, 1) },
                        onRemove = { viewModel.removeTile(tile.id) },
                    )
                }
                item {
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        SettingsDropdown(
                            label = "Tile",
                            options = HomeTileKind.entries,
                            selected = newTileKind,
                            optionLabel = ::homeTileKindLabel,
                            onSelect = { newTileKind = it },
                        )
                        Button(
                            onClick = {
                                val tile = createHomeTile(newTileKind)
                                viewModel.addTile(tile)
                                editingTile = tile
                            },
                            modifier = Modifier.padding(top = 8.dp),
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null)
                            Text("Add Tile", modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
                item {
                    HorizontalDivider(modifier = Modifier.padding(top = 16.dp))
                    SettingsHeader(
                        title = "Home Sections",
                        description = "Reorder Home rows and choose which ones are shown",
                    )
                }
                itemsIndexed(state.sections, key = { _, section -> section.id }) { index, section ->
                    HomeSectionRow(
                        section = section,
                        canMoveUp = index > 0,
                        canMoveDown = index < state.sections.lastIndex,
                        onToggleEnabled = { enabled ->
                            viewModel.setSectionEnabled(section.id, enabled)
                        },
                        onEdit = { editingSection = section },
                        onMoveUp = { viewModel.moveSection(section.id, -1) },
                        onMoveDown = { viewModel.moveSection(section.id, 1) },
                        onRemove = { viewModel.removeSection(section.id) },
                    )
                }
                item {
                    Button(
                        onClick = {
                            val section = createPlaylistHomeSection()
                            viewModel.addSection(section)
                            editingSection = section
                        },
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null)
                        Text("Add Playlist Section", modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeTileRow(
    tile: HomeTileConfig,
    sections: List<HomeSectionConfig>,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onEdit: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit,
) {
    val presentation = homeTilePresentation(tile, sections)
    ListItem(
        headlineContent = { Text(presentation.label) },
        supportingContent = { Text(presentation.subtitle) },
        leadingContent = { Icon(presentation.icon, contentDescription = null) },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CompactIconButton(
                    icon = Icons.Filled.Edit,
                    contentDescription = "Edit ${presentation.label}",
                    onClick = onEdit,
                )
                CompactIconButton(
                    icon = Icons.Filled.ArrowUpward,
                    contentDescription = "Move ${presentation.label} up",
                    enabled = canMoveUp,
                    onClick = onMoveUp,
                )
                CompactIconButton(
                    icon = Icons.Filled.ArrowDownward,
                    contentDescription = "Move ${presentation.label} down",
                    enabled = canMoveDown,
                    onClick = onMoveDown,
                )
                CompactIconButton(
                    icon = Icons.Filled.Delete,
                    contentDescription = "Remove ${presentation.label}",
                    onClick = onRemove,
                )
            }
        },
    )
}

@Composable
private fun HomeSectionRow(
    section: HomeSectionConfig,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onToggleEnabled: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit,
) {
    val label = homeSectionLabel(section)
    ListItem(
        headlineContent = { Text(label) },
        supportingContent = { Text(homeSectionDescription(section)) },
        leadingContent = { Icon(homeSectionIcon(section), contentDescription = null) },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = section.enabled,
                    onCheckedChange = onToggleEnabled,
                )
                CompactIconButton(
                    icon = Icons.Filled.Edit,
                    contentDescription = "Edit $label",
                    enabled = homeSectionHasSettings(section.kind),
                    onClick = onEdit,
                )
                CompactIconButton(
                    icon = Icons.Filled.ArrowUpward,
                    contentDescription = "Move $label up",
                    enabled = canMoveUp,
                    onClick = onMoveUp,
                )
                CompactIconButton(
                    icon = Icons.Filled.ArrowDownward,
                    contentDescription = "Move $label down",
                    enabled = canMoveDown,
                    onClick = onMoveDown,
                )
                if (section.kind == HomeSectionKind.PLAYLIST_SONGS) {
                    CompactIconButton(
                        icon = Icons.Filled.Delete,
                        contentDescription = "Remove $label",
                        onClick = onRemove,
                    )
                }
            }
        },
    )
}

@Composable
private fun CompactIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(40.dp),
    ) {
        Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun SettingsHeader(title: String, description: String) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun HomeTileEditDialog(
    tile: HomeTileConfig,
    sections: List<HomeSectionConfig>,
    playlistChoices: List<HomePlaylistChoice>,
    accounts: List<Account>,
    onSave: (HomeTileConfig) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember(tile.id) { mutableStateOf(tile) }
    val presentation = homeTilePresentation(draft, sections)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit Home Tile") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Choose what this tile points at and what it does when pressed.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SettingsDropdown(
                    label = "Tile",
                    options = HomeTileKind.entries,
                    selected = draft.kind,
                    optionLabel = ::homeTileKindLabel,
                    onSelect = { kind ->
                        draft = draft.copy(
                            kind = kind,
                            action = defaultHomeTileAction(kind),
                            playlistId = null,
                            playlistName = null,
                            playlistType = null,
                            accountKey = null,
                            accountLabel = null,
                        )
                    },
                )
                if (draft.kind != HomeTileKind.ACCOUNT_SWITCH) {
                    SettingsDropdown(
                        label = "Action",
                        options = supportedHomeTileActions(draft.kind),
                        selected = draft.effectiveAction,
                        optionLabel = ::homeTileActionLabel,
                        onSelect = { action -> draft = draft.copy(action = action) },
                    )
                }
                if (draft.kind == HomeTileKind.PLAYLIST) {
                    SettingsDropdown(
                        label = "Playlist",
                        options = playlistChoices,
                        selected = playlistChoices.firstOrNull { it.id == draft.playlistId },
                        optionLabel = ::homePlaylistChoiceLabel,
                        placeholder = "Choose playlist",
                        emptyLabel = "No playlists found",
                        onSelect = { choice ->
                            draft = draft.copy(
                                playlistId = choice.id,
                                playlistName = choice.name,
                                playlistType = choice.type,
                            )
                        },
                    )
                }
                if (draft.kind == HomeTileKind.ACCOUNT_SWITCH) {
                    SettingsDropdown(
                        label = "Account",
                        options = accounts,
                        selected = accounts.firstOrNull { it.id == draft.accountKey },
                        optionLabel = { it.label },
                        placeholder = "Choose account",
                        onSelect = { account ->
                            draft = draft.copy(
                                accountKey = account.id,
                                accountLabel = account.label,
                            )
                        },
                    )
                }
                if (presentation.isIncomplete) {
                    Text(
                        text = "Choose the missing setting before this tile can be used.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(draft) }) { Text("Done") }
        },
    )
}

@Composable
private fun HomeSectionEditDialog(
    section: HomeSectionConfig,
    playlistChoices: List<HomePlaylistChoice>,
    onSave: (HomeSectionConfig) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember(section.id) { mutableStateOf(section) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(homeSectionLabel(section)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Tune how this section chooses its items.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when (section.kind) {
                    HomeSectionKind.MOST_PLAYED_RECENTLY -> NumberField(
                        label = "Days back",
                        value = draft.mostPlayedDays,
                        onValueChange = { draft = draft.copy(mostPlayedRecentlyDays = it) },
                    )

                    HomeSectionKind.FORGOTTEN_FAVORITES -> {
                        NumberField(
                            label = "Minimum plays",
                            value = draft.forgottenMinPlays,
                            onValueChange = { draft = draft.copy(forgottenFavoritesMinPlays = it) },
                        )
                        NumberField(
                            label = "Not played for days",
                            value = draft.forgottenNotPlayedDays,
                            onValueChange = {
                                draft = draft.copy(forgottenFavoritesNotPlayedSinceDays = it)
                            },
                        )
                    }

                    HomeSectionKind.TOP_ALBUMS -> NumberField(
                        label = "Days back",
                        value = draft.topAlbumsPeriodDays,
                        onValueChange = { draft = draft.copy(topAlbumsDays = it) },
                    )

                    HomeSectionKind.PLAYLIST_SONGS -> {
                        SettingsDropdown(
                            label = "Playlist",
                            options = playlistChoices,
                            selected = playlistChoices.firstOrNull { it.id == draft.playlistId },
                            optionLabel = ::homePlaylistChoiceLabel,
                            placeholder = "Choose playlist",
                            emptyLabel = "No playlists found",
                            onSelect = { choice ->
                                draft = draft.copy(
                                    playlistId = choice.id,
                                    playlistName = choice.name,
                                    playlistType = choice.type,
                                )
                            },
                        )
                        if (!draft.isPlaylistConfigured) {
                            Text(
                                text = "Choose the playlist before this section appears on Home.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }

                    else -> Unit
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(draft) }) { Text("Done") }
        },
    )
}

@Composable
private fun NumberField(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
) {
    OutlinedTextField(
        value = value.toString(),
        onValueChange = { text -> onValueChange(max(1, text.toIntOrNull() ?: 1)) },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun <T> SettingsDropdown(
    label: String,
    options: List<T>,
    selected: T?,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
    placeholder: String = "Choose…",
    emptyLabel: String = "No options found",
) {
    var expanded by remember { mutableStateOf(false) }

    Column {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Box {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = selected?.let(optionLabel) ?: placeholder,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                if (options.isEmpty()) {
                    DropdownMenuItem(
                        text = { Text(emptyLabel) },
                        enabled = false,
                        onClick = { expanded = false },
                    )
                }
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(optionLabel(option)) },
                        onClick = {
                            expanded = false
                            onSelect(option)
                        },
                        trailingIcon = {
                            if (option == selected) {
                                Icon(Icons.Filled.Check, contentDescription = null)
                            }
                        },
                    )
                }
            }
        }
    }
}
