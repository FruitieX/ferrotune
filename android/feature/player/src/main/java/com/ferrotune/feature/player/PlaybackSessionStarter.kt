package com.ferrotune.feature.player

import com.ferrotune.core.datastore.AccountStore
import com.ferrotune.core.media.PlaybackRepository
import com.ferrotune.core.media.PlaybackSettings
import com.ferrotune.core.media.SessionConfig
import com.ferrotune.core.network.FerrotuneApiFactory
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.ConnectSessionRequest
import com.ferrotune.core.network.dto.StartQueueRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * Starts server-side playback sessions for the signed-in account and hands
 * the resulting session to [PlaybackRepository].
 */
@Singleton
class PlaybackSessionStarter @Inject constructor(
    private val apiFactory: FerrotuneApiFactory,
    private val accountStore: AccountStore,
    private val repository: PlaybackRepository,
) {
    suspend fun startRandomQueue(size: Int = DEFAULT_RANDOM_QUEUE_SIZE) {
        val account = accountStore.activeAccount.first()
            ?: throw IllegalStateException("Not signed in")
        val clientId = accountStore.clientId()
        val api = apiFactory.create(account.serverUrl) { account.sessionToken }

        val songs = apiCall { api.randomSongs(size) }.song
        check(songs.isNotEmpty()) { "Server returned no songs" }

        val session = apiCall {
            api.connectSession(ConnectSessionRequest(clientId = clientId))
        }

        val queue = apiCall {
            api.startQueue(
                StartQueueRequest(
                    sessionId = session.id,
                    sourceType = SOURCE_TYPE_RANDOM,
                    sourceName = "Random songs",
                    startIndex = 0,
                    songIds = songs.map { it.id },
                    clientId = clientId,
                )
            )
        }

        repository.initSession(
            config = SessionConfig(
                serverUrl = account.serverUrl,
                username = account.username,
                sessionToken = account.sessionToken,
                sessionExpiresAt = account.sessionExpiresAt,
                sessionId = session.id,
                clientId = clientId,
            ),
            settings = PlaybackSettings(),
        )

        repository.startPlayback(
            totalCount = queue.totalCount,
            currentIndex = queue.currentIndex,
            isShuffled = queue.isShuffled,
            repeatMode = queue.repeatMode,
            sessionId = session.id,
            sourceType = SOURCE_TYPE_RANDOM,
            sourceId = null,
        )
    }

    private companion object {
        const val DEFAULT_RANDOM_QUEUE_SIZE = 50
        const val SOURCE_TYPE_RANDOM = "other"
    }
}
