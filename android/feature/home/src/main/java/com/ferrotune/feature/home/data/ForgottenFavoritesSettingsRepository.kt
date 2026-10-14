package com.ferrotune.feature.home.data

import com.ferrotune.core.network.ServerPreferences
import com.ferrotune.core.network.generated.ForgottenFavoritesSettings as ForgottenFavoritesSettingsDto
import com.ferrotune.core.network.mapState
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

/** Which songs count as forgotten favorites (web `forgottenFavoritesSettingsAtom`). */
data class ForgottenFavoritesSettings(
    val minPlays: Int = DEFAULT_MIN_PLAYS,
    val notPlayedSinceDays: Int = DEFAULT_NOT_PLAYED_DAYS,
) {
    companion object {
        const val DEFAULT_MIN_PLAYS = 10
        const val DEFAULT_NOT_PLAYED_DAYS = 90
    }
}

/**
 * The user's forgotten-favorites thresholds under the shared
 * `forgotten-favorites` key. The server reads this preference for every
 * forgotten-favorites list and queue, so clients never send thresholds.
 */
@Singleton
class ForgottenFavoritesSettingsRepository @Inject constructor(
    private val preferences: ServerPreferences,
) {
    val settings: StateFlow<ForgottenFavoritesSettings> = preferences.snapshot.mapState { snapshot ->
        snapshot.preferences[KEY]?.let(::parse) ?: ForgottenFavoritesSettings()
    }

    private val savedEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /**
     * Emits once the server has stored a change. [ServerPreferences.set] is
     * optimistic, so lists reload on this rather than on [settings].
     */
    val saved: SharedFlow<Unit> = savedEvents.asSharedFlow()

    suspend fun set(settings: ForgottenFavoritesSettings) {
        val dto = ForgottenFavoritesSettingsDto(
            minPlays = maxOf(1, settings.minPlays).toLong(),
            notPlayedSinceDays = maxOf(1, settings.notPlayedSinceDays).toLong(),
        )
        preferences.set(KEY, Json.encodeToJsonElement(dto))
        savedEvents.tryEmit(Unit)
    }

    private fun parse(value: JsonElement): ForgottenFavoritesSettings {
        val dto = runCatching { lenientJson.decodeFromJsonElement<ForgottenFavoritesSettingsDto>(value) }
            .getOrNull() ?: return ForgottenFavoritesSettings()
        return ForgottenFavoritesSettings(
            minPlays = dto.minPlays.coerceIn(1, Int.MAX_VALUE.toLong()).toInt(),
            notPlayedSinceDays = dto.notPlayedSinceDays.coerceIn(1, Int.MAX_VALUE.toLong()).toInt(),
        )
    }

    companion object {
        const val KEY = "forgotten-favorites"

        private val lenientJson = Json { ignoreUnknownKeys = true }
    }
}
