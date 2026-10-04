package com.ferrotune.core.network

import android.content.Context
import com.ferrotune.core.network.generated.SetPreferenceRequest
import com.ferrotune.core.network.generated.UpdatePreferencesRequest
import com.ferrotune.core.network.generated.PreferencesResponse
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement

/** On-device copy of each account's last known server preferences. */
interface PreferencesCache {
    suspend fun read(accountId: String): PreferencesResponse?
    suspend fun write(accountId: String, preferences: PreferencesResponse)
}

/** [PreferencesCache] stored as one JSON file per account in the app's files directory. */
class FilePreferencesCache @Inject constructor(
    @ApplicationContext private val context: Context,
) : PreferencesCache {
    private fun file(accountId: String): File =
        File(File(context.filesDir, "server-preferences"), accountId.replace(UNSAFE, "_") + ".json")

    override suspend fun read(accountId: String): PreferencesResponse? = withContext(Dispatchers.IO) {
        runCatching {
            file(accountId).takeIf { it.isFile }?.readText()
                ?.let { FerrotuneJson.decodeFromString(PreferencesResponse.serializer(), it) }
        }.getOrNull()
    }

    override suspend fun write(accountId: String, preferences: PreferencesResponse) {
        withContext(Dispatchers.IO) {
            runCatching {
                val target = file(accountId)
                target.parentFile?.mkdirs()
                val temp = File(target.parentFile, target.name + ".tmp")
                temp.writeText(FerrotuneJson.encodeToString(PreferencesResponse.serializer(), preferences))
                temp.renameTo(target)
            }
        }
    }

    private companion object {
        val UNSAFE = Regex("[^A-Za-z0-9_-]")
    }
}

/**
 * The active account's server-synced preferences (`GET /api/preferences`),
 * shared by every preference repository so the app makes one request instead
 * of one per feature.
 *
 * The last known values are cached on device per account: [ensureLoaded]
 * returns them immediately and refreshes from the server in the background,
 * so a cold start (or an offline one) shows the saved accent, Home layout, and
 * sorts instead of defaults. Writes apply optimistically and roll back when the
 * server rejects them.
 */
@Singleton
class ServerPreferences(
    private val apiProvider: FerrotuneApiProvider,
    private val cache: PreferencesCache,
    dispatcher: CoroutineDispatcher,
) : AccountScopedPreferences {

    @Inject
    constructor(
        apiProvider: FerrotuneApiProvider,
        cache: PreferencesCache,
    ) : this(apiProvider, cache, Dispatchers.IO)

    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val mutex = Mutex()

    private val _snapshot = MutableStateFlow(EMPTY)

    /** Current values; [EMPTY] until something has been loaded for the account. */
    val snapshot: StateFlow<PreferencesResponse> = _snapshot.asStateFlow()

    /** Account whose values [snapshot] holds. */
    private var accountId: String? = null
    private var hasData = false
    private var refreshJob: Deferred<Unit>? = null
    private var fetchedAtMs = 0L

    /**
     * Makes [snapshot] reflect the active account. Returns as soon as cached or
     * fresh values are available; the first call per account (after
     * [invalidate], or once the last server read is older than [maxAgeMs]) also
     * refreshes from the server. Throws only when nothing is known for the
     * account and the server can't be reached.
     */
    suspend fun ensureLoaded(maxAgeMs: Long = Long.MAX_VALUE) {
        val account = apiProvider.requireAccount()
        val pending = mutex.withLock {
            selectAccount(account.id)
            val job = refreshJob?.takeUnless { it.isFailed() || isStale(maxAgeMs) }
                ?: scope.async { fetch(account.id) }.also { refreshJob = it }
            if (hasData) null else job
        }
        pending?.await()
    }

    /** Re-reads the server's values now; failures propagate to the caller. */
    suspend fun refresh() {
        val account = apiProvider.requireAccount()
        val job = mutex.withLock {
            selectAccount(account.id)
            scope.async { fetch(account.id) }.also { refreshJob = it }
        }
        job.await()
    }

    /** Forgets that the server was read, so the next [ensureLoaded] refreshes. */
    override fun invalidate() {
        refreshJob = null
    }

    /** Stores one generic preference, optimistically. */
    suspend fun set(key: String, value: JsonElement) {
        val previous = _snapshot.value.preferences[key]
        _snapshot.value = _snapshot.value.withPreference(key, value)
        try {
            apiProvider.requireApi().setPreference(key, SetPreferenceRequest(value))
        } catch (e: Exception) {
            _snapshot.value = _snapshot.value.withPreference(key, previous)
            throw e
        }
        persist()
    }

    /** Stores the dedicated accent fields, optimistically. */
    suspend fun setAccent(name: String, hue: Double, lightness: Double, chroma: Double) {
        val previous = _snapshot.value
        _snapshot.value = previous.copy(
            accentColor = name,
            customAccentHue = hue,
            customAccentLightness = lightness,
            customAccentChroma = chroma,
        )
        val response = try {
            apiProvider.requireApi().updatePreferences(
                UpdatePreferencesRequest(
                    accentColor = name,
                    customAccentHue = hue,
                    customAccentLightness = lightness,
                    customAccentChroma = chroma,
                ),
            )
        } catch (e: Exception) {
            _snapshot.value = _snapshot.value.copy(
                accentColor = previous.accentColor,
                customAccentHue = previous.customAccentHue,
                customAccentLightness = previous.customAccentLightness,
                customAccentChroma = previous.customAccentChroma,
            )
            throw e
        }
        _snapshot.value = response
        persist()
    }

    /** Must be called with [mutex] held. */
    private suspend fun selectAccount(id: String) {
        if (accountId == id) return
        accountId = id
        refreshJob?.cancel()
        refreshJob = null
        val cached = cache.read(id)
        _snapshot.value = cached ?: EMPTY
        hasData = cached != null
    }

    private suspend fun fetch(id: String) {
        val response = apiProvider.requireApi().preferences()
        mutex.withLock {
            if (accountId != id) return
            _snapshot.value = response
            hasData = true
            fetchedAtMs = nowMs()
        }
        cache.write(id, response)
    }

    private suspend fun persist() {
        val id = mutex.withLock { accountId.takeIf { hasData } } ?: return
        cache.write(id, _snapshot.value)
    }

    /** A finished server read older than [maxAgeMs]; an in-flight read is never stale. */
    private fun isStale(maxAgeMs: Long): Boolean =
        refreshJob?.isCompleted == true && nowMs() - fetchedAtMs > maxAgeMs

    private fun nowMs(): Long = System.nanoTime() / 1_000_000

    private fun Deferred<*>.isFailed(): Boolean =
        isCancelled || (isCompleted && getCompletionExceptionOrNull() != null)

    companion object {
        val EMPTY = PreferencesResponse(accentColor = "", preferences = emptyMap())
    }
}

private fun PreferencesResponse.withPreference(key: String, value: JsonElement?): PreferencesResponse =
    copy(preferences = if (value == null) preferences - key else preferences + (key to value))
