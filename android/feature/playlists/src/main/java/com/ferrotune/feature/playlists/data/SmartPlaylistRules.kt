package com.ferrotune.feature.playlists.data

import com.ferrotune.core.network.generated.MusicFolderInfo
import com.ferrotune.core.network.generated.PlaylistFolderResponse
import com.ferrotune.core.network.generated.PlaylistInFolder
import com.ferrotune.core.network.generated.SmartPlaylistConditionApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

enum class RuleFieldType { TEXT, NUMBER, DATE, BOOLEAN, ENUM, MULTI_ENUM }

data class RuleEnumOption(val value: String, val label: String)

data class RuleField(
    val apiName: String,
    val label: String,
    val type: RuleFieldType,
    val enumOptions: List<RuleEnumOption> = emptyList(),
)

data class RuleOperator(val value: String, val label: String)

data class SmartConditionDraft(
    val id: Long,
    val field: String,
    val operator: String,
    val text: String = "",
    val number: String = "",
    val boolean: Boolean = false,
    val selected: Set<String> = emptySet(),
)

private val TEXT_OPERATORS = listOf(
    RuleOperator("contains", "contains"),
    RuleOperator("notContains", "does not contain"),
    RuleOperator("eq", "equals"),
    RuleOperator("neq", "does not equal"),
    RuleOperator("startsWith", "starts with"),
    RuleOperator("endsWith", "ends with"),
    RuleOperator("empty", "is empty"),
    RuleOperator("notEmpty", "is not empty"),
)

private val NUMBER_OPERATORS = listOf(
    RuleOperator("eq", "equals"),
    RuleOperator("neq", "does not equal"),
    RuleOperator("gt", "greater than"),
    RuleOperator("gte", "at least"),
    RuleOperator("lt", "less than"),
    RuleOperator("lte", "at most"),
    RuleOperator("empty", "is empty"),
    RuleOperator("notEmpty", "is not empty"),
)

private val DATE_OPERATORS = listOf(
    RuleOperator("within", "within last"),
    RuleOperator("gt", "after"),
    RuleOperator("lt", "before"),
    RuleOperator("empty", "never"),
    RuleOperator("notEmpty", "has value"),
)

private val BOOLEAN_OPERATORS = listOf(
    RuleOperator("eq", "is"),
    RuleOperator("neq", "is not"),
)

private val ENUM_OPERATORS = listOf(
    RuleOperator("eq", "is"),
    RuleOperator("neq", "is not"),
)

private val MULTI_ENUM_OPERATORS = listOf(
    RuleOperator("eq", "includes any of"),
    RuleOperator("neq", "excludes all of"),
)

fun operatorsFor(type: RuleFieldType): List<RuleOperator> = when (type) {
    RuleFieldType.TEXT -> TEXT_OPERATORS
    RuleFieldType.NUMBER -> NUMBER_OPERATORS
    RuleFieldType.DATE -> DATE_OPERATORS
    RuleFieldType.BOOLEAN -> BOOLEAN_OPERATORS
    RuleFieldType.ENUM -> ENUM_OPERATORS
    RuleFieldType.MULTI_ENUM -> MULTI_ENUM_OPERATORS
}

fun operatorNeedsValue(operator: String): Boolean = operator != "empty" && operator != "notEmpty"

private val BASE_RULE_FIELDS = listOf(
    RuleField("artist", "Artist", RuleFieldType.TEXT),
    RuleField("album", "Album", RuleFieldType.TEXT),
    RuleField("title", "Title", RuleFieldType.TEXT),
    RuleField("genre", "Genre", RuleFieldType.TEXT),
    RuleField("year", "Year", RuleFieldType.NUMBER),
    RuleField("playCount", "Play Count", RuleFieldType.NUMBER),
    RuleField("playStarts", "Play Starts", RuleFieldType.NUMBER),
    RuleField("duration", "Duration (seconds)", RuleFieldType.NUMBER),
    RuleField("bitrate", "Bitrate (kbps)", RuleFieldType.NUMBER),
    RuleField("rating", "Rating", RuleFieldType.NUMBER),
    RuleField("dateAdded", "Date Added", RuleFieldType.DATE),
    RuleField("lastPlayed", "Last Played", RuleFieldType.DATE),
    RuleField(
        apiName = "fileFormat",
        label = "File Format",
        type = RuleFieldType.ENUM,
        enumOptions = listOf(
            RuleEnumOption("flac", "FLAC"),
            RuleEnumOption("mp3", "MP3"),
            RuleEnumOption("opus", "Opus"),
            RuleEnumOption("ogg", "Ogg Vorbis"),
            RuleEnumOption("m4a", "M4A/AAC"),
            RuleEnumOption("wav", "WAV"),
            RuleEnumOption("aiff", "AIFF"),
        ),
    ),
    RuleField("starred", "Starred", RuleFieldType.BOOLEAN),
    RuleField(
        apiName = "coverArt",
        label = "Cover Art",
        type = RuleFieldType.ENUM,
        enumOptions = listOf(
            RuleEnumOption("any", "Has Cover Art"),
            RuleEnumOption("embedded", "Has Embedded Cover Art"),
            RuleEnumOption("album", "Has Album Cover Art"),
        ),
    ),
    RuleField("coverArtResolution", "Cover Art Resolution", RuleFieldType.NUMBER),
    RuleField("shuffleExcluded", "Shuffle Excluded", RuleFieldType.BOOLEAN),
    RuleField("disabled", "Disabled", RuleFieldType.BOOLEAN),
)

/**
 * Field list for the rule editor. Dynamic fields (library, in playlist,
 * in playlist folder) only appear when the matching data is available, and
 * `library` is hidden for single-folder libraries like the web editor.
 */
fun ruleFields(
    musicFolders: List<MusicFolderInfo>,
    playlists: List<PlaylistInFolder>,
    folders: List<PlaylistFolderResponse>,
): List<RuleField> = buildList {
    addAll(BASE_RULE_FIELDS)
    if (musicFolders.size > 1) {
        add(
            RuleField(
                apiName = "library",
                label = "Library",
                type = RuleFieldType.ENUM,
                enumOptions = musicFolders.map { RuleEnumOption(it.id.toString(), it.name) },
            ),
        )
    }
    if (playlists.isNotEmpty()) {
        add(
            RuleField(
                apiName = "inPlaylist",
                label = "In Playlist",
                type = RuleFieldType.MULTI_ENUM,
                enumOptions = playlists.map { RuleEnumOption(it.id, it.name) },
            ),
        )
    }
    if (folders.isNotEmpty()) {
        add(
            RuleField(
                apiName = "inPlaylistFolder",
                label = "In Playlist Folder",
                type = RuleFieldType.ENUM,
                enumOptions = folders.map { RuleEnumOption(it.id, it.name) },
            ),
        )
    }
}

fun List<RuleField>.fieldByName(apiName: String): RuleField? =
    firstOrNull { it.apiName == apiName }

fun newConditionDraft(fields: List<RuleField>, id: Long): SmartConditionDraft {
    val field = fields.first()
    val operator = operatorsFor(field.type).first()
    return SmartConditionDraft(
        id = id,
        field = field.apiName,
        operator = operator.value,
        boolean = false,
    )
}

fun SmartConditionDraft.toApiCondition(fields: List<RuleField>): SmartPlaylistConditionApi? {
    val field = fields.fieldByName(field) ?: return null
    val value = when {
        !operatorNeedsValue(operator) -> JsonPrimitive(true)
        field.type == RuleFieldType.TEXT || field.type == RuleFieldType.DATE -> JsonPrimitive(text)
        field.type == RuleFieldType.NUMBER -> number.toLongOrNull()?.let { JsonPrimitive(it) } ?: return null
        field.type == RuleFieldType.BOOLEAN -> JsonPrimitive(boolean)
        field.type == RuleFieldType.ENUM -> text.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) } ?: return null
        field.type == RuleFieldType.MULTI_ENUM -> {
            if (selected.isEmpty()) return null
            JsonArray(selected.sorted().map { JsonPrimitive(it) })
        }
        else -> return null
    }
    return SmartPlaylistConditionApi(field.apiName, operator, value)
}

fun SmartPlaylistConditionApi.toDraft(id: Long): SmartConditionDraft {
    var text = ""
    var number = ""
    var boolean = false
    var selected = emptySet<String>()
    when (val json = value) {
        is JsonArray -> selected = json.mapNotNull { (it as? JsonPrimitive)?.content }.toSet()
        is JsonPrimitive -> {
            if (json === JsonNull) {
                text = ""
            } else {
                json.booleanOrNull?.let { boolean = it }
                json.longOrNull?.let { number = it.toString() }
                text = json.content
            }
        }
        else -> Unit
    }
    return SmartConditionDraft(
        id = id,
        field = field,
        operator = operator,
        text = text,
        number = number,
        boolean = boolean,
        selected = selected,
    )
}
