package com.ferrotune.core.actions

import com.ferrotune.core.network.AccountScopedPreferences
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.SetDisabledRequest
import com.ferrotune.core.network.generated.BulkSetDisabledRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The account's disabled songs (web `disabledSongsAtom`): tracks excluded from
 * automatic playback. Loaded once per account; changes apply optimistically
 * and roll back when the server refuses them. The server already leaves
 * disabled songs out when it builds queues.
 */
@Singleton
class DisabledSongsStore @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
) : AccountScopedPreferences {
    private val _disabled = MutableStateFlow<Set<String>>(emptySet())
    val disabled: StateFlow<Set<String>> = _disabled.asStateFlow()

    private val mutex = Mutex()
    private var loaded = false

    /** Best-effort; rows simply don't dim until it succeeds. */
    suspend fun ensureLoaded() {
        mutex.withLock {
            if (loaded) return
            runCatching { apiCall { apiProvider.requireApi().disabledSongs() } }
                .onSuccess {
                    _disabled.value = it.songIds.toSet()
                    loaded = true
                }
        }
    }

    suspend fun setDisabled(songId: String, disabled: Boolean) {
        val before = _disabled.value
        _disabled.update { if (disabled) it + songId else it - songId }
        try {
            apiCall { apiProvider.requireApi().setSongDisabled(songId, SetDisabledRequest(disabled)) }
        } catch (e: Exception) {
            _disabled.update { if (songId in before) it + songId else it - songId }
            throw e
        }
    }

    suspend fun setDisabled(songIds: List<String>, disabled: Boolean) {
        if (songIds.isEmpty()) return
        val before = _disabled.value
        _disabled.update { if (disabled) it + songIds else it - songIds.toSet() }
        try {
            apiCall { apiProvider.requireApi().setSongsDisabled(BulkSetDisabledRequest(songIds, disabled)) }
        } catch (e: Exception) {
            _disabled.update { current -> songIds.fold(current) { set, id -> if (id in before) set + id else set - id } }
            throw e
        }
    }

    override fun invalidate() {
        loaded = false
        _disabled.value = emptySet()
    }
}
