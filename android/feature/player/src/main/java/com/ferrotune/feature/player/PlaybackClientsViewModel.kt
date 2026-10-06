package com.ferrotune.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ferrotune.core.actions.UserMessages
import com.ferrotune.core.datastore.Accounts
import com.ferrotune.core.media.PlaybackStarter
import com.ferrotune.core.media.PlaybackStatus
import com.ferrotune.core.media.cast.CastSessionPort
import com.ferrotune.core.media.cast.castClientId
import com.ferrotune.core.network.FerrotuneApiProvider
import com.ferrotune.core.network.apiCall
import com.ferrotune.core.network.dto.SessionCommandRequest
import com.ferrotune.core.network.generated.ClientResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Who plays the shared session's audio. When another client owns it, this
 * app is a remote control and the player shows "Playing on <device>".
 */
data class PlaybackClientsUiState(
    val sessionId: String? = null,
    /** Another client owns the session (web "follower" mode). */
    val isFollowing: Boolean = false,
    /** The owner's friendly name, once the client list is known. */
    val ownerDisplayName: String? = null,
    val ownerClientName: String? = null,
    val clients: List<ClientResponse> = emptyList(),
    val myClientId: String? = null,
    /** This phone's own Cast receiver owns the session: the receiver's name. */
    val castingTo: String? = null,
)

@HiltViewModel
class PlaybackClientsViewModel @Inject constructor(
    private val apiProvider: FerrotuneApiProvider,
    private val playbackStarter: PlaybackStarter,
    private val accounts: Accounts,
    private val messages: UserMessages,
    cast: CastSessionPort,
) : ViewModel() {

    private val clients = MutableStateFlow<List<ClientResponse>>(emptyList())
    private val myClientId = MutableStateFlow<String?>(null)

    private data class Ownership(
        val sessionId: String?,
        /** Another client owns the session; a cleared owner means nobody plays. */
        val following: Boolean,
        val ownerClientName: String?,
        val ownerClientId: String?,
    )

    private val owner = playbackStarter.state
        .map {
            Ownership(
                sessionId = it.sessionId,
                following = it.sessionId != null && !it.ownsSession && it.sessionOwnerClientId != null,
                ownerClientName = it.sessionOwnerClientName,
                ownerClientId = it.sessionOwnerClientId,
            )
        }
        .distinctUntilChanged()

    val uiState: StateFlow<PlaybackClientsUiState> = combine(owner, clients, myClientId, cast.state) { ownership, list, me, castState ->
        val ownCast = me != null && ownership.ownerClientId == castClientId(me)
        PlaybackClientsUiState(
            castingTo = if (ownCast) castState.deviceName ?: "Cast device" else null,
            sessionId = ownership.sessionId,
            isFollowing = ownership.following,
            ownerDisplayName = list.firstOrNull { it.isOwner }?.displayName,
            ownerClientName = ownership.ownerClientName,
            clients = list,
            myClientId = me,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaybackClientsUiState())

    init {
        viewModelScope.launch { myClientId.value = runCatching { accounts.clientId() }.getOrNull() }
        // The owner's friendly name comes from the client list; refresh it whenever ownership moves.
        viewModelScope.launch {
            owner.collect { ownership ->
                if (ownership.following) refresh() else if (ownership.sessionId == null) clients.value = emptyList()
            }
        }
    }

    /** Re-reads the connected clients (opening the sheet, ownership changes). */
    fun refresh() {
        viewModelScope.launch {
            runCatching { apiCall { apiProvider.requireApi().sessionClients() } }
                .onSuccess { clients.value = it.clients }
        }
    }

    /**
     * Moves audio to [client], like the web's "Connected Clients" menu. The
     * server tells the old owner to pause and the new one (possibly this app,
     * via its session events) to resume from the current position.
     */
    fun transferTo(client: ClientResponse) {
        val sessionId = uiState.value.sessionId ?: return
        if (client.isOwner) return
        val state = playbackStarter.state.value
        val resume = state.status == PlaybackStatus.PLAYING || state.status == PlaybackStatus.BUFFERING || uiState.value.isFollowing
        viewModelScope.launch {
            runCatching {
                apiCall {
                    apiProvider.requireApi().sessionCommand(
                        sessionId,
                        SessionCommandRequest(
                            action = "takeOver",
                            // Only the owner's position is authoritative; a remote control lets the server keep its own.
                            positionMs = state.positionMs.takeIf { state.ownsSession && it > 0 },
                            clientName = client.clientName,
                            clientId = client.clientId,
                            resumePlayback = resume,
                        ),
                    )
                }
            }
                .onSuccess {
                    messages.show(if (client.clientId == myClientId.value) "Playing on this phone" else "Playing on ${client.displayName}")
                    refresh()
                }
                .onFailure { messages.failure("Couldn't transfer playback", it) }
        }
    }
}
