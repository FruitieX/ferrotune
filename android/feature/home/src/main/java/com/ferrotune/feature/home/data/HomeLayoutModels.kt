package com.ferrotune.feature.home.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Dashboard models mirroring the web client's `home-tiles-v1` and
 * `home-sections-v1` preference shapes. The JSON is shared with the web/Tauri
 * client, so field names and value strings must stay identical.
 */

enum class HomeTileKind(val apiValue: String) {
    FAVORITES("favorites"),
    HISTORY("history"),
    FORGOTTEN_FAVORITES("forgottenFavorites"),
    MOST_PLAYED_RECENTLY("mostPlayedRecently"),
    CONTINUE_LISTENING("continueListening"),
    RECENTLY_ADDED("recentlyAdded"),
    DISCOVER("discover"),
    SIMILAR_TRACKS("similarTracks"),
    PLAYLIST("playlist"),
    ACCOUNT_SWITCH("accountSwitch"),
    ;

    companion object {
        fun fromApiValue(value: String?): HomeTileKind? =
            entries.firstOrNull { it.apiValue == value }
    }
}

enum class HomeTileActionMode(val apiValue: String) {
    OPEN("open"),
    PLAY("play"),
    SHUFFLE("shuffle"),
    ;

    companion object {
        fun fromApiValue(value: String?): HomeTileActionMode? =
            entries.firstOrNull { it.apiValue == value }
    }
}

enum class HomePlaylistType(val apiValue: String) {
    PLAYLIST("playlist"),
    SMART_PLAYLIST("smartPlaylist"),
    ;

    companion object {
        fun fromApiValue(value: String?): HomePlaylistType? =
            entries.firstOrNull { it.apiValue == value }
    }
}

data class HomeTileConfig(
    val id: String,
    val kind: HomeTileKind,
    val action: HomeTileActionMode? = null,
    val playlistId: String? = null,
    val playlistName: String? = null,
    val playlistType: HomePlaylistType? = null,
    val accountKey: String? = null,
    val accountLabel: String? = null,
) {
    val effectiveAction: HomeTileActionMode?
        get() = action ?: defaultHomeTileAction(kind)
}

fun defaultHomeTileAction(kind: HomeTileKind): HomeTileActionMode? = when (kind) {
    HomeTileKind.ACCOUNT_SWITCH -> null
    HomeTileKind.PLAYLIST -> HomeTileActionMode.PLAY
    else -> HomeTileActionMode.OPEN
}

fun supportedHomeTileActions(kind: HomeTileKind): List<HomeTileActionMode> =
    if (kind == HomeTileKind.ACCOUNT_SWITCH) {
        emptyList()
    } else {
        HomeTileActionMode.entries.toList()
    }

fun createHomeTile(
    kind: HomeTileKind,
    action: HomeTileActionMode? = defaultHomeTileAction(kind),
    playlistId: String? = null,
    playlistName: String? = null,
    playlistType: HomePlaylistType? = null,
    accountKey: String? = null,
    accountLabel: String? = null,
    id: String = "${kind.apiValue}-${System.currentTimeMillis()}-${(100_000..999_999).random()}",
): HomeTileConfig = HomeTileConfig(
    id = id,
    kind = kind,
    action = action,
    playlistId = playlistId,
    playlistName = playlistName,
    playlistType = playlistType,
    accountKey = accountKey,
    accountLabel = accountLabel,
)

val DEFAULT_HOME_TILES: List<HomeTileConfig> = listOf(
    HomeTileConfig(id = "favorites", kind = HomeTileKind.FAVORITES, action = HomeTileActionMode.OPEN),
    HomeTileConfig(id = "history", kind = HomeTileKind.HISTORY, action = HomeTileActionMode.OPEN),
)

fun parseHomeTiles(array: JsonArray): List<HomeTileConfig> =
    array.mapIndexedNotNull { index, element ->
        val obj = element as? JsonObject ?: return@mapIndexedNotNull null
        val kind = HomeTileKind.fromApiValue(obj.string("kind")) ?: return@mapIndexedNotNull null
        HomeTileConfig(
            id = obj.string("id") ?: "${kind.apiValue}-$index",
            kind = kind,
            action = HomeTileActionMode.fromApiValue(obj.string("action"))
                ?: defaultHomeTileAction(kind),
            playlistId = obj.string("playlistId"),
            playlistName = obj.string("playlistName"),
            playlistType = HomePlaylistType.fromApiValue(obj.string("playlistType")),
            accountKey = obj.string("accountKey"),
            accountLabel = obj.string("accountLabel"),
        )
    }

fun encodeHomeTiles(tiles: List<HomeTileConfig>): JsonArray = JsonArray(
    tiles.map { tile ->
        buildJsonObject {
            put("id", JsonPrimitive(tile.id))
            put("kind", JsonPrimitive(tile.kind.apiValue))
            tile.effectiveAction?.let { put("action", JsonPrimitive(it.apiValue)) }
            tile.playlistId?.let { put("playlistId", JsonPrimitive(it)) }
            tile.playlistName?.let { put("playlistName", JsonPrimitive(it)) }
            tile.playlistType?.let { put("playlistType", JsonPrimitive(it.apiValue)) }
            tile.accountKey?.let { put("accountKey", JsonPrimitive(it)) }
            tile.accountLabel?.let { put("accountLabel", JsonPrimitive(it)) }
        }
    },
)

enum class HomeSectionKind(val apiValue: String) {
    CONTINUE_LISTENING("continueListening"),
    MOST_PLAYED_RECENTLY("mostPlayedRecently"),
    RECENTLY_ADDED("recentlyAdded"),
    FORGOTTEN_FAVORITES("forgottenFavorites"),
    DISCOVER("discover"),
    SIMILAR_TRACKS("similarTracks"),
    TOP_ALBUMS("topAlbums"),
    RECENT_ALBUMS("recentAlbums"),
    PLAYLIST_SONGS("playlistSongs"),
    ;

    companion object {
        fun fromApiValue(value: String?): HomeSectionKind? =
            entries.firstOrNull { it.apiValue == value }
    }
}

const val DEFAULT_MOST_PLAYED_RECENTLY_DAYS = 30
const val DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS = 10
const val DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS = 90
const val DEFAULT_TOP_ALBUMS_DAYS = 90

data class HomeSectionConfig(
    val id: String,
    val kind: HomeSectionKind,
    val enabled: Boolean = true,
    val mostPlayedRecentlyDays: Int? = null,
    val forgottenFavoritesMinPlays: Int? = null,
    val forgottenFavoritesNotPlayedSinceDays: Int? = null,
    val topAlbumsDays: Int? = null,
    val playlistId: String? = null,
    val playlistName: String? = null,
    val playlistType: HomePlaylistType? = null,
) {
    val mostPlayedDays: Int
        get() = maxOf(1, mostPlayedRecentlyDays ?: DEFAULT_MOST_PLAYED_RECENTLY_DAYS)

    val forgottenMinPlays: Int
        get() = maxOf(1, forgottenFavoritesMinPlays ?: DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS)

    val forgottenNotPlayedDays: Int
        get() = maxOf(
            1,
            forgottenFavoritesNotPlayedSinceDays
                ?: DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
        )

    val topAlbumsPeriodDays: Int
        get() = maxOf(1, topAlbumsDays ?: DEFAULT_TOP_ALBUMS_DAYS)

    val isPlaylistConfigured: Boolean
        get() = !playlistId.isNullOrBlank() && playlistType != null
}

val DEFAULT_HOME_SECTIONS: List<HomeSectionConfig> = listOf(
    HomeSectionConfig(id = "continue-listening", kind = HomeSectionKind.CONTINUE_LISTENING),
    HomeSectionConfig(
        id = "most-played-recently",
        kind = HomeSectionKind.MOST_PLAYED_RECENTLY,
        mostPlayedRecentlyDays = DEFAULT_MOST_PLAYED_RECENTLY_DAYS,
    ),
    HomeSectionConfig(id = "recently-added", kind = HomeSectionKind.RECENTLY_ADDED),
    HomeSectionConfig(
        id = "forgotten-favorites",
        kind = HomeSectionKind.FORGOTTEN_FAVORITES,
        forgottenFavoritesMinPlays = DEFAULT_FORGOTTEN_FAVORITES_MIN_PLAYS,
        forgottenFavoritesNotPlayedSinceDays = DEFAULT_FORGOTTEN_FAVORITES_NOT_PLAYED_DAYS,
    ),
    HomeSectionConfig(id = "discover", kind = HomeSectionKind.DISCOVER),
    HomeSectionConfig(id = "similar-tracks", kind = HomeSectionKind.SIMILAR_TRACKS),
    HomeSectionConfig(
        id = "top-albums",
        kind = HomeSectionKind.TOP_ALBUMS,
        enabled = false,
        topAlbumsDays = DEFAULT_TOP_ALBUMS_DAYS,
    ),
    HomeSectionConfig(
        id = "recent-albums",
        kind = HomeSectionKind.RECENT_ALBUMS,
        enabled = false,
    ),
)

fun defaultHomeSection(kind: HomeSectionKind): HomeSectionConfig =
    DEFAULT_HOME_SECTIONS.firstOrNull { it.kind == kind }
        ?: HomeSectionConfig(id = kind.apiValue, kind = kind)

fun createPlaylistHomeSection(
    playlistId: String? = null,
    playlistName: String? = null,
    playlistType: HomePlaylistType? = null,
    id: String = "playlist-songs-${System.currentTimeMillis()}-${(10_000..99_999).random()}",
): HomeSectionConfig = HomeSectionConfig(
    id = id,
    kind = HomeSectionKind.PLAYLIST_SONGS,
    playlistId = playlistId,
    playlistName = playlistName,
    playlistType = playlistType,
)

/**
 * Drops unknown section kinds, applies kind defaults to missing fields, and
 * appends any missing built-in sections (matching the web client).
 */
fun normalizeHomeSections(sections: List<HomeSectionConfig>): List<HomeSectionConfig> {
    val normalized = sections.mapNotNull { section ->
        val defaults = DEFAULT_HOME_SECTIONS.firstOrNull { it.kind == section.kind }
        when (section.kind) {
            HomeSectionKind.PLAYLIST_SONGS -> section
            else -> section.withDefaults(defaults)
        }
    }
    val configuredKinds = normalized.map { it.kind }.toSet()
    return normalized + DEFAULT_HOME_SECTIONS.filter { it.kind !in configuredKinds }
}

private fun HomeSectionConfig.withDefaults(defaults: HomeSectionConfig?): HomeSectionConfig =
    copy(
        enabled = enabled,
        mostPlayedRecentlyDays = mostPlayedRecentlyDays
            ?: defaults?.mostPlayedRecentlyDays,
        forgottenFavoritesMinPlays = forgottenFavoritesMinPlays
            ?: defaults?.forgottenFavoritesMinPlays,
        forgottenFavoritesNotPlayedSinceDays = forgottenFavoritesNotPlayedSinceDays
            ?: defaults?.forgottenFavoritesNotPlayedSinceDays,
        topAlbumsDays = topAlbumsDays ?: defaults?.topAlbumsDays,
    )

fun parseHomeSections(array: JsonArray): List<HomeSectionConfig> = normalizeHomeSections(
    array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val kind = HomeSectionKind.fromApiValue(obj.string("kind")) ?: return@mapNotNull null
        HomeSectionConfig(
            id = obj.string("id") ?: kind.apiValue,
            kind = kind,
            enabled = obj.boolean("enabled")
                ?: DEFAULT_HOME_SECTIONS.firstOrNull { it.kind == kind }?.enabled
                ?: true,
            mostPlayedRecentlyDays = obj.int("mostPlayedRecentlyDays"),
            forgottenFavoritesMinPlays = obj.int("forgottenFavoritesMinPlays"),
            forgottenFavoritesNotPlayedSinceDays = obj.int("forgottenFavoritesNotPlayedSinceDays"),
            topAlbumsDays = obj.int("topAlbumsDays"),
            playlistId = obj.string("playlistId"),
            playlistName = obj.string("playlistName"),
            playlistType = HomePlaylistType.fromApiValue(obj.string("playlistType")),
        )
    },
)

fun encodeHomeSections(sections: List<HomeSectionConfig>): JsonArray = JsonArray(
    sections.map { section ->
        buildJsonObject {
            put("id", JsonPrimitive(section.id))
            put("kind", JsonPrimitive(section.kind.apiValue))
            put("enabled", JsonPrimitive(section.enabled))
            when (section.kind) {
                HomeSectionKind.MOST_PLAYED_RECENTLY ->
                    put("mostPlayedRecentlyDays", JsonPrimitive(section.mostPlayedDays))

                HomeSectionKind.FORGOTTEN_FAVORITES -> {
                    put("forgottenFavoritesMinPlays", JsonPrimitive(section.forgottenMinPlays))
                    put(
                        "forgottenFavoritesNotPlayedSinceDays",
                        JsonPrimitive(section.forgottenNotPlayedDays),
                    )
                }

                HomeSectionKind.TOP_ALBUMS ->
                    put("topAlbumsDays", JsonPrimitive(section.topAlbumsPeriodDays))

                HomeSectionKind.PLAYLIST_SONGS -> {
                    section.playlistId?.let { put("playlistId", JsonPrimitive(it)) }
                    section.playlistName?.let { put("playlistName", JsonPrimitive(it)) }
                    section.playlistType?.let { put("playlistType", JsonPrimitive(it.apiValue)) }
                }

                else -> Unit
            }
        }
    },
)

/** ISO-8601 instant `days` ago, matching the web client's `toISOString()`. */
fun mostPlayedRecentlySince(days: Int, nowMillis: Long = System.currentTimeMillis()): String {
    val sinceMillis = nowMillis - maxOf(1, days) * MILLIS_PER_DAY
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date(sinceMillis))
}

private const val MILLIS_PER_DAY = 24L * 60L * 60L * 1000L

private fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.boolean(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.booleanOrNull
