package com.ferrotune.feature.library.data

import com.ferrotune.core.network.generated.SearchParams
import com.ferrotune.core.network.generated.SmartPlaylistConditionApi
import java.util.Locale
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Web `AdvancedFilters` for the library views: optional ranges and flags the
 * server applies to search/browse and to queue materialization. Not
 * persisted, like the web atom. Durations are seconds, bitrates kbps, and
 * dates `YYYY-MM-DD`.
 */
data class LibraryFilters(
    val minYear: Int? = null,
    val maxYear: Int? = null,
    val genre: String? = null,
    val minDuration: Int? = null,
    val maxDuration: Int? = null,
    val minRating: Int? = null,
    val maxRating: Int? = null,
    val starredOnly: Boolean = false,
    val minPlayCount: Int? = null,
    val maxPlayCount: Int? = null,
    val minBitrate: Int? = null,
    val maxBitrate: Int? = null,
    val fileFormat: String? = null,
    val addedAfter: String? = null,
    val addedBefore: String? = null,
    val lastPlayedAfter: String? = null,
    val lastPlayedBefore: String? = null,
    val missingCoverArt: Boolean = false,
    val shuffleExcludedOnly: Boolean = false,
    val disabledOnly: Boolean = false,
) {
    val isActive: Boolean get() = this != NONE

    /** The fields the web albums view sends (year, genre, rating, favorites). */
    fun forAlbums(): LibraryFilters = LibraryFilters(
        minYear = minYear,
        maxYear = maxYear,
        genre = genre,
        minRating = minRating,
        maxRating = maxRating,
        starredOnly = starredOnly,
    )

    /** The fields the web artists view sends (rating, favorites). */
    fun forArtists(): LibraryFilters = LibraryFilters(
        minRating = minRating,
        maxRating = maxRating,
        starredOnly = starredOnly,
    )

    /** Adds these filters to [params]; a favorites-only request stays favorites-only. */
    fun applyTo(params: SearchParams): SearchParams = params.copy(
        minYear = minYear,
        maxYear = maxYear,
        genre = genre ?: params.genre,
        minDuration = minDuration,
        maxDuration = maxDuration,
        minRating = minRating,
        maxRating = maxRating,
        starredOnly = if (starredOnly) true else params.starredOnly,
        minPlayCount = minPlayCount,
        maxPlayCount = maxPlayCount,
        minBitrate = minBitrate,
        maxBitrate = maxBitrate,
        fileFormat = fileFormat,
        addedAfter = addedAfter,
        addedBefore = addedBefore,
        lastPlayedAfter = lastPlayedAfter,
        lastPlayedBefore = lastPlayedBefore,
        missingCoverArt = missingCoverArt.takeIf { it },
        shuffleExcludedOnly = shuffleExcludedOnly.takeIf { it },
        disabledOnly = disabledOnly.takeIf { it },
    )

    /** Queue `filters` entries, so playback materializes the filtered list (web spreads them in). */
    fun toQueueFilters(): Map<String, JsonElement> = buildMap {
        minYear?.let { put("minYear", JsonPrimitive(it)) }
        maxYear?.let { put("maxYear", JsonPrimitive(it)) }
        genre?.let { put("genre", JsonPrimitive(it)) }
        minDuration?.let { put("minDuration", JsonPrimitive(it)) }
        maxDuration?.let { put("maxDuration", JsonPrimitive(it)) }
        minRating?.let { put("minRating", JsonPrimitive(it)) }
        maxRating?.let { put("maxRating", JsonPrimitive(it)) }
        if (starredOnly) put("starredOnly", JsonPrimitive(true))
        minPlayCount?.let { put("minPlayCount", JsonPrimitive(it)) }
        maxPlayCount?.let { put("maxPlayCount", JsonPrimitive(it)) }
        minBitrate?.let { put("minBitrate", JsonPrimitive(it)) }
        maxBitrate?.let { put("maxBitrate", JsonPrimitive(it)) }
        fileFormat?.let { put("fileFormat", JsonPrimitive(it)) }
        addedAfter?.let { put("addedAfter", JsonPrimitive(it)) }
        addedBefore?.let { put("addedBefore", JsonPrimitive(it)) }
        lastPlayedAfter?.let { put("lastPlayedAfter", JsonPrimitive(it)) }
        lastPlayedBefore?.let { put("lastPlayedBefore", JsonPrimitive(it)) }
        if (missingCoverArt) put("missingCoverArt", JsonPrimitive(true))
        if (shuffleExcludedOnly) put("shuffleExcludedOnly", JsonPrimitive(true))
        if (disabledOnly) put("disabledOnly", JsonPrimitive(true))
    }

    /**
     * Smart playlist rules matching these filters (web `flatToRules`), all
     * required ("and"), for "Save as smart playlist".
     */
    fun toSmartPlaylistConditions(): List<SmartPlaylistConditionApi> = buildList {
        fun rule(field: String, operator: String, value: JsonElement) = add(SmartPlaylistConditionApi(field, operator, value))
        minYear?.let { rule("year", "gte", JsonPrimitive(it)) }
        maxYear?.let { rule("year", "lte", JsonPrimitive(it)) }
        genre?.let { rule("genre", "eq", JsonPrimitive(it)) }
        minDuration?.let { rule("duration", "gte", JsonPrimitive(it)) }
        maxDuration?.let { rule("duration", "lte", JsonPrimitive(it)) }
        minRating?.let { rule("rating", "gte", JsonPrimitive(it)) }
        maxRating?.let { rule("rating", "lte", JsonPrimitive(it)) }
        if (starredOnly) rule("starred", "eq", JsonPrimitive(true))
        minPlayCount?.let { rule("playCount", "gte", JsonPrimitive(it)) }
        maxPlayCount?.let { rule("playCount", "lte", JsonPrimitive(it)) }
        if (shuffleExcludedOnly) rule("shuffleExcluded", "eq", JsonPrimitive(true))
        minBitrate?.let { rule("bitrate", "gte", JsonPrimitive(it)) }
        maxBitrate?.let { rule("bitrate", "lte", JsonPrimitive(it)) }
        addedAfter?.let { rule("dateAdded", "gt", JsonPrimitive(it)) }
        addedBefore?.let { rule("dateAdded", "lt", JsonPrimitive(it)) }
        lastPlayedAfter?.let { rule("lastPlayed", "gt", JsonPrimitive(it)) }
        lastPlayedBefore?.let { rule("lastPlayed", "lt", JsonPrimitive(it)) }
        fileFormat?.let { rule("fileFormat", "eq", JsonPrimitive(it)) }
        if (missingCoverArt) rule("coverArt", "neq", JsonPrimitive("any"))
        if (disabledOnly) rule("disabled", "eq", JsonPrimitive(true))
    }

    /** One removable chip per active filter (web `ActiveFilterBadges`). */
    fun badges(): List<FilterBadge> = buildList {
        range("Year", minYear, maxYear) { copy(minYear = null, maxYear = null) }
        genre?.let { add(FilterBadge("Genre: $it", copy(genre = null))) }
        range("Duration", minDuration?.let(::formatSeconds), maxDuration?.let(::formatSeconds)) {
            copy(minDuration = null, maxDuration = null)
        }
        range("Rating", minRating?.let { "$it★" }, maxRating?.let { "$it★" }) { copy(minRating = null, maxRating = null) }
        if (starredOnly) add(FilterBadge("Favorites", copy(starredOnly = false)))
        range("Plays", minPlayCount, maxPlayCount) { copy(minPlayCount = null, maxPlayCount = null) }
        range("Bitrate", minBitrate?.let { "$it kbps" }, maxBitrate?.let { "$it kbps" }) {
            copy(minBitrate = null, maxBitrate = null)
        }
        fileFormat?.let { add(FilterBadge("Format: ${it.uppercase()}", copy(fileFormat = null))) }
        range("Added", addedAfter, addedBefore) { copy(addedAfter = null, addedBefore = null) }
        range("Last played", lastPlayedAfter, lastPlayedBefore) { copy(lastPlayedAfter = null, lastPlayedBefore = null) }
        if (missingCoverArt) add(FilterBadge("Missing cover art", copy(missingCoverArt = false)))
        if (shuffleExcludedOnly) add(FilterBadge("Shuffle excluded", copy(shuffleExcludedOnly = false)))
        if (disabledOnly) add(FilterBadge("Disabled", copy(disabledOnly = false)))
    }

    private fun MutableList<FilterBadge>.range(label: String, min: Any?, max: Any?, cleared: LibraryFilters.() -> LibraryFilters) {
        val text = when {
            min != null && max != null -> "$label: $min–$max"
            min != null -> "$label ≥ $min"
            max != null -> "$label ≤ $max"
            else -> return
        }
        add(FilterBadge(text, cleared()))
    }

    companion object {
        val NONE = LibraryFilters()

        /** Web file format choices. */
        val FILE_FORMATS = listOf(
            "flac" to "FLAC",
            "mp3" to "MP3",
            "opus" to "Opus",
            "ogg" to "Ogg Vorbis",
            "m4a" to "M4A/AAC",
            "wav" to "WAV",
            "aiff" to "AIFF",
        )
    }
}

/** An active filter's label and the filters without it. */
data class FilterBadge(val label: String, val without: LibraryFilters)

private fun formatSeconds(seconds: Int): String = "%d:%02d".format(Locale.ROOT, seconds / 60, seconds % 60)
