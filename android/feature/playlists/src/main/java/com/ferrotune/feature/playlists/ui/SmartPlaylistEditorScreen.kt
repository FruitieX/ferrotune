package com.ferrotune.feature.playlists.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.feature.playlists.data.PlaylistFolderNode
import com.ferrotune.feature.playlists.data.RuleField
import com.ferrotune.feature.playlists.data.RuleFieldType
import com.ferrotune.feature.playlists.data.SmartConditionDraft
import com.ferrotune.feature.playlists.data.fieldByName
import com.ferrotune.feature.playlists.data.operatorNeedsValue
import com.ferrotune.feature.playlists.data.operatorsFor

@Composable
fun SmartPlaylistEditorScreen(
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SmartPlaylistEditorViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var folderPickerOpen by remember { mutableStateOf(false) }

    LaunchedEffect(state.saved) {
        if (state.saved) onDone()
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Text(if (state.isEditing) "Edit smart playlist" else "New smart playlist")
                },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(
                        onClick = viewModel::save,
                        enabled = state.canSave && !state.saving,
                    ) {
                        Text("Save")
                    }
                },
            )
        },
    ) { padding ->
        if (state.loading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::setName,
                label = { Text("Name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.comment,
                onValueChange = viewModel::setComment,
                label = { Text("Comment") },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedButton(
                onClick = { folderPickerOpen = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Folder: " + (state.folderId?.let { id -> folderName(state.folderNodes, id) }
                        ?: "None"),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                OutlinedTextField(
                    value = state.maxSongs,
                    onValueChange = viewModel::setMaxSongs,
                    label = { Text("Max songs") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Public")
                    Switch(
                        checked = state.isPublic,
                        onCheckedChange = viewModel::setPublic,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }

            Text("Match", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.logic == "and",
                    onClick = { viewModel.setLogic("and") },
                    label = { Text("All conditions") },
                )
                FilterChip(
                    selected = state.logic == "or",
                    onClick = { viewModel.setLogic("or") },
                    label = { Text("Any condition") },
                )
            }

            Text("Conditions", style = MaterialTheme.typography.titleSmall)
            state.conditions.forEach { draft ->
                ConditionCard(
                    draft = draft,
                    fields = state.fields,
                    onFieldChange = { viewModel.changeConditionField(draft.id, it) },
                    onOperatorChange = { viewModel.updateCondition(draft.copy(operator = it)) },
                    onDraftChange = viewModel::updateCondition,
                    onRemove = { viewModel.removeCondition(draft.id) },
                )
            }
            OutlinedButton(onClick = viewModel::addCondition) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text("Add condition", modifier = Modifier.padding(start = 8.dp))
            }

            Text("Sort", style = MaterialTheme.typography.titleSmall)
            DropdownField(
                label = "Sort by",
                valueLabel = SMART_PLAYLIST_SORT_OPTIONS
                    .firstOrNull { it.value == state.sortField }?.label ?: "Random",
                options = SMART_PLAYLIST_SORT_OPTIONS.map { (it.value ?: "") to it.label },
                onSelect = { viewModel.setSortField(it.ifEmpty { null }) },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.sortDirection == "asc",
                    onClick = { viewModel.setSortDirection("asc") },
                    label = { Text("Ascending") },
                )
                FilterChip(
                    selected = state.sortDirection == "desc",
                    onClick = { viewModel.setSortDirection("desc") },
                    label = { Text("Descending") },
                )
            }

            state.error?.let { message ->
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }

    if (folderPickerOpen) {
        FolderPickerDialog(
            title = "Choose folder",
            nodes = state.folderNodes,
            onDismiss = { folderPickerOpen = false },
            onSelect = {
                folderPickerOpen = false
                viewModel.setFolderId(it)
            },
        )
    }
}

@Composable
private fun ConditionCard(
    draft: SmartConditionDraft,
    fields: List<RuleField>,
    onFieldChange: (String) -> Unit,
    onOperatorChange: (String) -> Unit,
    onDraftChange: (SmartConditionDraft) -> Unit,
    onRemove: () -> Unit,
) {
    val field = fields.fieldByName(draft.field) ?: return
    val operators = operatorsFor(field.type)

    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DropdownField(
                    label = "Field",
                    valueLabel = field.label,
                    options = fields.map { it.apiName to it.label },
                    onSelect = onFieldChange,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onRemove) {
                    Icon(Icons.Filled.Delete, contentDescription = "Remove condition")
                }
            }

            DropdownField(
                label = "Operator",
                valueLabel = operators.firstOrNull { it.value == draft.operator }?.label
                    ?: draft.operator,
                options = operators.map { it.value to it.label },
                onSelect = onOperatorChange,
                modifier = Modifier.fillMaxWidth(),
            )

            if (operatorNeedsValue(draft.operator)) {
                ConditionValueEditor(
                    draft = draft,
                    field = field,
                    onDraftChange = onDraftChange,
                )
            }
        }
    }
}

@Composable
private fun ConditionValueEditor(
    draft: SmartConditionDraft,
    field: RuleField,
    onDraftChange: (SmartConditionDraft) -> Unit,
) {
    when (field.type) {
        RuleFieldType.TEXT -> OutlinedTextField(
            value = draft.text,
            onValueChange = { onDraftChange(draft.copy(text = it)) },
            label = { Text("Value") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        RuleFieldType.DATE -> OutlinedTextField(
            value = draft.text,
            onValueChange = { onDraftChange(draft.copy(text = it)) },
            label = { Text("Value") },
            supportingText = { Text("e.g. 30d, 6mo, 1y for \"within last\"") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        RuleFieldType.NUMBER -> OutlinedTextField(
            value = draft.number,
            onValueChange = { onDraftChange(draft.copy(number = it)) },
            label = { Text("Value") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        RuleFieldType.BOOLEAN -> Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Value")
            Switch(
                checked = draft.boolean,
                onCheckedChange = { onDraftChange(draft.copy(boolean = it)) },
                modifier = Modifier.padding(start = 8.dp),
            )
        }

        RuleFieldType.ENUM -> DropdownField(
            label = "Value",
            valueLabel = field.enumOptions.firstOrNull { it.value == draft.text }?.label
                ?: "Choose",
            options = field.enumOptions.map { it.value to it.label },
            onSelect = { onDraftChange(draft.copy(text = it)) },
            modifier = Modifier.fillMaxWidth(),
        )

        RuleFieldType.MULTI_ENUM -> MultiSelectDropdown(
            label = "Value",
            selected = draft.selected,
            options = field.enumOptions.map { it.value to it.label },
            onToggle = { value ->
                val next = draft.selected.toMutableSet()
                if (!next.add(value)) next.remove(value)
                onDraftChange(draft.copy(selected = next))
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun DropdownField(
    label: String,
    valueLabel: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        var expanded by remember { mutableStateOf(false) }
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "$label: $valueLabel",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { (value, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    onClick = {
                        expanded = false
                        onSelect(value)
                    },
                )
            }
        }
    }
}

@Composable
private fun MultiSelectDropdown(
    label: String,
    selected: Set<String>,
    options: List<Pair<String, String>>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        var expanded by remember { mutableStateOf(false) }
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "$label: ${selected.size} selected",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { (value, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    trailingIcon = {
                        if (value in selected) {
                            Text("✓")
                        }
                    },
                    onClick = { onToggle(value) },
                )
            }
        }
    }
}

private fun folderName(nodes: List<PlaylistFolderNode>, id: String): String? {
    nodes.forEach { node ->
        if (node.folder.id == id) return node.folder.name
        folderName(node.children, id)?.let { return it }
    }
    return null
}
