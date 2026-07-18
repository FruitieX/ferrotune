//! Playback session management endpoints.
//!
//! Single-session-per-user model: each user has one persistent session.
//! Multiple clients (browser tabs, app instances) connect to the same session.
//! One client is the audio owner; others are followers.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::{AppState, ConnectedClient, ConnectedClientMetadata, SessionEvent};
use crate::db::queries;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    response::sse::{Event, Sse},
    Extension, Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};
use ts_rs::TS;

const REVERSE_DNS_TIMEOUT: Duration = Duration::from_millis(750);

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectSessionRequest {
    #[serde(default = "default_client_name")]
    pub client_name: String,
    pub client_id: Option<String>,
}

fn default_client_name() -> String {
    "ferrotune-web".to_string()
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ConnectSessionResponse {
    pub id: String,
    pub is_new_session: bool,
    pub owner_client_id: Option<String>,
    pub owner_client_name: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionResponse {
    pub id: String,
    pub is_playing: bool,
    pub current_song_id: Option<String>,
    pub current_song_title: Option<String>,
    pub current_song_artist: Option<String>,
    pub owner_client_id: Option<String>,
    pub owner_client_name: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ClientResponse {
    pub client_id: String,
    pub client_name: String,
    pub display_name: String,
    pub network_address: Option<String>,
    pub hostname: Option<String>,
    pub network_label: Option<String>,
    pub device_label: Option<String>,
    pub is_owner: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ClientListResponse {
    pub clients: Vec<ClientResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRequest {
    pub client_id: Option<String>,
    /// Optional client name (e.g. "ferrotune-web"). Used when the heartbeat
    /// has to re-register the client in the in-memory `SessionManager`
    /// (because its SSE was silently torn down but the tab is still alive).
    pub client_name: Option<String>,
    #[serde(default)]
    pub is_playing: bool,
    pub current_index: Option<usize>,
    pub position_ms: Option<i64>,
    pub current_song_id: Option<String>,
    pub current_song_title: Option<String>,
    pub current_song_artist: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommandRequest {
    pub action: String,
    pub position_ms: Option<i64>,
    pub current_index: Option<usize>,
    pub volume: Option<f64>,
    pub is_muted: Option<bool>,
    pub client_name: Option<String>,
    pub client_id: Option<String>,
    pub resume_playback: Option<bool>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionSuccessResponse {
    pub success: bool,
}

/// Query params for SSE events endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventsQuery {
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub device_label: Option<String>,
}

// ============================================================================
// Helper: compute display names for connected clients
// ============================================================================

fn compute_display_names(
    clients: &[ConnectedClient],
    owner_client_id: Option<&str>,
) -> Vec<ClientResponse> {
    let mut web_count = 0usize;
    let mut mobile_count = 0usize;
    let mut cast_count = 0usize;

    // First pass: count by type
    for c in clients {
        match c.client_name.as_str() {
            "ferrotune-mobile" => mobile_count += 1,
            "ferrotune-cast" => cast_count += 1,
            _ => web_count += 1,
        }
    }

    // Second pass: assign display names
    let mut web_index = 0usize;
    let mut mobile_index = 0usize;
    let mut cast_index = 0usize;
    let mut result = Vec::with_capacity(clients.len());

    for c in clients {
        let (prefix, count, index) = match c.client_name.as_str() {
            "ferrotune-mobile" => {
                mobile_index += 1;
                ("Mobile", mobile_count, mobile_index)
            }
            "ferrotune-cast" => {
                cast_index += 1;
                ("Chromecast", cast_count, cast_index)
            }
            _ => {
                web_index += 1;
                ("Web", web_count, web_index)
            }
        };
        let display_name = if count == 1 {
            prefix.to_string()
        } else {
            format!("{} {}", prefix, index)
        };
        result.push(ClientResponse {
            client_id: c.client_id.clone(),
            client_name: c.client_name.clone(),
            display_name,
            network_address: c.network_address.clone(),
            hostname: c.hostname.clone(),
            network_label: c.hostname.clone().or_else(|| c.network_address.clone()),
            device_label: c.device_label.clone(),
            is_owner: owner_client_id == Some(c.client_id.as_str()),
        });
    }
    result
}

fn normalize_client_label(value: Option<&str>) -> Option<String> {
    const MAX_LABEL_CHARS: usize = 120;

    let trimmed = value?.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.chars().take(MAX_LABEL_CHARS).collect())
}

async fn reverse_dns_hostname(network_address: String) -> Option<String> {
    let lookup_address = network_address.clone();
    let handle = tokio::task::spawn_blocking(move || {
        let ip = lookup_address.parse().ok()?;
        dns_lookup::lookup_addr(&ip).ok()
    });

    let hostname = tokio::time::timeout(REVERSE_DNS_TIMEOUT, handle)
        .await
        .ok()?
        .ok()??;

    let hostname = normalize_client_label(Some(&hostname))?;
    if hostname == network_address {
        return None;
    }

    Some(hostname)
}

fn resolve_hostname_in_background(
    state: Arc<AppState>,
    session_id: String,
    client_id: String,
    network_address: String,
) {
    tokio::spawn(async move {
        let Some(hostname) = reverse_dns_hostname(network_address.clone()).await else {
            return;
        };

        let changed = state
            .session_manager
            .update_client_hostname(&session_id, &client_id, &network_address, hostname)
            .await;
        if changed {
            state
                .session_manager
                .broadcast(&session_id, SessionEvent::ClientListChanged)
                .await;
        }
    });
}

// ============================================================================
// Endpoints
// ============================================================================

/// POST /api/sessions — Connect to (or create) the user's session
pub async fn connect_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ConnectSessionRequest>,
) -> FerrotuneApiResult<Json<ConnectSessionResponse>> {
    // Check if session already exists
    let existing = queries::get_user_session(&state.database, user.user_id).await?;
    let is_new = existing.is_none();

    let session = queries::get_or_create_session(&state.database, user.user_id).await?;

    let (owner_client_id, owner_client_name) = if is_new && request.client_id.is_some() {
        let client_id = request.client_id.as_ref().unwrap();
        queries::update_session_owner(
            &state.database,
            &session.id,
            Some(client_id),
            &request.client_name,
        )
        .await?;

        (Some(client_id.clone()), request.client_name.clone())
    } else {
        (session.owner_client_id, session.owner_client_name)
    };

    Ok(Json(ConnectSessionResponse {
        id: session.id,
        is_new_session: is_new,
        owner_client_id,
        owner_client_name,
    }))
}

/// GET /api/sessions — Get the user's session info
pub async fn get_session_info(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SessionResponse>> {
    let session = queries::get_or_create_session(&state.database, user.user_id).await?;

    Ok(Json(SessionResponse {
        id: session.id,
        is_playing: session.is_playing,
        current_song_id: session.current_song_id,
        current_song_title: session.current_song_title,
        current_song_artist: session.current_song_artist,
        owner_client_id: session.owner_client_id,
        owner_client_name: session.owner_client_name,
    }))
}

/// GET /api/sessions/clients — List connected clients
pub async fn list_clients(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ClientListResponse>> {
    let session = queries::get_or_create_session(&state.database, user.user_id).await?;
    let clients = state.session_manager.get_clients(&session.id).await;
    let client_responses = compute_display_names(&clients, session.owner_client_id.as_deref());

    Ok(Json(ClientListResponse {
        clients: client_responses,
    }))
}

/// POST /api/sessions/:id/heartbeat — Update heartbeat + playback state
pub async fn session_heartbeat(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<HeartbeatRequest>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Refresh (or re-create) this client's entry in the in-memory
    // `SessionManager`. The connected-clients list is keyed on SSE liveness,
    // and a tab's SSE can be silently torn down by a proxy/browser even though
    // the tab itself keeps playing (and heartbeating). Recording the heartbeat
    // here keeps the tab visible + remotely controllable for
    // `HEARTBEAT_GRACE` after the SSE drops, and the background sweep reaps it
    // only once heartbeats also stop.
    if let Some(ref client_id) = request.client_id {
        let created = state
            .session_manager
            .record_heartbeat(&session.id, client_id, request.client_name.as_deref())
            .await;
        if created {
            state
                .session_manager
                .broadcast(&session.id, SessionEvent::ClientListChanged)
                .await;
        }
    }

    // Distinguish owner heartbeats (include song info or position) from
    // follower keepalive heartbeats (only { isPlaying: false }).
    // Only owner heartbeats should update playback state and broadcast.
    let is_owner_heartbeat = request.current_index.is_some()
        || request.position_ms.is_some()
        || request.current_song_id.is_some()
        || request.current_song_title.is_some()
        || request.current_song_artist.is_some();

    let is_current_owner = request
        .client_id
        .as_deref()
        .is_some_and(|client_id| session.owner_client_id.as_deref() == Some(client_id));

    if is_owner_heartbeat && is_current_owner {
        queries::update_session_heartbeat_with_position(
            &state.database,
            &session_id,
            request.is_playing,
            request.current_song_id.as_deref(),
            request.current_song_title.as_deref(),
            request.current_song_artist.as_deref(),
            request.current_index.map(|i| i as i64),
            request.position_ms,
        )
        .await?;

        // Broadcast position update to SSE subscribers
        state
            .session_manager
            .broadcast(
                &session_id,
                SessionEvent::PositionUpdate {
                    current_index: request.current_index.unwrap_or(0),
                    position_ms: request.position_ms.unwrap_or(0),
                    is_playing: request.is_playing,
                    current_song_id: request.current_song_id.clone(),
                    current_song_title: request.current_song_title.clone(),
                    current_song_artist: request.current_song_artist.clone(),
                },
            )
            .await;
    } else {
        // Follower keepalive or stale owner heartbeat: only update the
        // heartbeat timestamp. Stale owners can otherwise keep overwriting the
        // real owner's queue position after a handover if their hidden tab or
        // native service wakes up late.
        queries::update_session_heartbeat_timestamp(&state.database, &session_id).await?;
    }

    Ok(Json(SessionSuccessResponse { success: true }))
}

/// Guard that unregisters a client when the SSE stream is dropped.
struct ClientCleanupGuard {
    session_id: String,
    user_id: i64,
    client_id: Option<String>,
    state: Arc<AppState>,
}

/// Detach a client from a session after its SSE stream is gone.
///
/// When `force` is false (the SSE-drop case), only the current session owner is
/// kept alive while it has a fresh heartbeat, so an audio-playing tab whose SSE
/// was silently torn down by a proxy/browser stays controllable remotely. Plain
/// follower tabs are removed immediately because their stale entries otherwise
/// linger until the heartbeat grace period expires.
///
/// When `force` is true (explicit disconnect beacon from a closing tab), the
/// heartbeat grace period is skipped so the tab disappears from the
/// connected-clients list immediately.
///
/// In both cases, if the removed client was the session owner, ownership is
/// cleared and the change is broadcast. Broadcasts are only emitted when the
/// client was actually removed, so a no-op request for an already-gone client
/// doesn't trigger spurious refreshes.
async fn detach_client(
    state: &Arc<AppState>,
    session_id: &str,
    user_id: i64,
    client_id: &str,
    force: bool,
) {
    let session = queries::get_session(&state.database, session_id, user_id)
        .await
        .ok()
        .flatten();
    let is_owner = session
        .as_ref()
        .and_then(|session| session.owner_client_id.as_deref())
        == Some(client_id);
    let removed = if force {
        state
            .session_manager
            .force_remove_client(session_id, client_id)
            .await
    } else if is_owner {
        state
            .session_manager
            .unregister_client(session_id, client_id)
            .await
    } else {
        state
            .session_manager
            .unregister_client_without_grace(session_id, client_id)
            .await
    };

    if !removed {
        return;
    }

    let owner_cleared = if is_owner {
        queries::clear_session_owner(&state.database, session_id)
            .await
            .is_ok()
    } else {
        false
    };

    if owner_cleared {
        state
            .session_manager
            .broadcast(
                session_id,
                SessionEvent::OwnerChanged {
                    owner_client_id: None,
                    owner_client_name: None,
                    resume_playback: None,
                    position_ms: None,
                },
            )
            .await;
    }

    // Notify other clients that the client list changed
    state
        .session_manager
        .broadcast(session_id, SessionEvent::ClientListChanged)
        .await;
}

impl Drop for ClientCleanupGuard {
    fn drop(&mut self) {
        let session_id = self.session_id.clone();
        let user_id = self.user_id;
        let client_id = self.client_id.clone();
        let state = self.state.clone();
        tokio::spawn(async move {
            if let Some(ref cid) = client_id {
                detach_client(&state, &session_id, user_id, cid, false).await;
            }
        });
    }
}

/// GET /api/sessions/:id/events — SSE stream of session events
pub async fn session_events(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Query(query): Query<SessionEventsQuery>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
) -> FerrotuneApiResult<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    let mut rx = state.session_manager.subscribe(&session.id).await;

    // Register client if client_id provided. Subscribe first so the newly
    // opened tab also receives the ClientListChanged event for itself.
    if let Some(ref client_id) = query.client_id {
        let client_name = query.client_name.as_deref().unwrap_or("ferrotune-web");
        let peer_ip = connect_info.map(|Extension(ConnectInfo(remote_addr))| remote_addr.ip());
        let remote_ip = crate::api::client_ip::resolve_client_ip(peer_ip, &headers);
        let metadata = ConnectedClientMetadata {
            remote_ip,
            hostname: None,
            device_label: normalize_client_label(query.device_label.as_deref()),
        };
        let network_address = metadata.network_address();
        state
            .session_manager
            .register_client(&session.id, client_id, client_name, metadata)
            .await;

        if let Some(network_address) = network_address {
            resolve_hostname_in_background(
                state.clone(),
                session.id.clone(),
                client_id.clone(),
                network_address,
            );
        }

        // Notify other clients that a new client connected
        state
            .session_manager
            .broadcast(&session.id, SessionEvent::ClientListChanged)
            .await;
    }

    // Read current queue position from the database for accurate initial state
    let (current_index, position_ms) = if let Ok(Some(queue)) =
        queries::get_play_queue_by_session(&state.database, &session.id, user.user_id).await
    {
        (queue.current_index as usize, queue.position_ms)
    } else {
        (0, 0)
    };

    // Build initial state to send immediately
    let initial_event = SessionEvent::PositionUpdate {
        current_index,
        position_ms,
        is_playing: session.is_playing,
        current_song_id: session.current_song_id,
        current_song_title: session.current_song_title,
        current_song_artist: session.current_song_artist,
    };

    // Send current ownership info so reconnecting clients can correct stale
    // isAudioOwner state (e.g. after the background inactivity timeout cleared
    // ownership while the client's SSE was disconnected).
    let owner_event = SessionEvent::OwnerChanged {
        owner_client_name: session
            .owner_client_id
            .as_ref()
            .map(|_| session.owner_client_name),
        owner_client_id: session.owner_client_id,
        resume_playback: None,
        position_ms: None,
    };

    // This guard is held by the stream; when axum drops the stream on client
    // disconnect, the guard's Drop impl unregisters the client.
    let _cleanup_guard = ClientCleanupGuard {
        session_id: session.id.clone(),
        user_id: user.user_id,
        client_id: query.client_id.clone(),
        state: state.clone(),
    };

    let stream = async_stream::stream! {
        let _guard = _cleanup_guard;

        // Send initial state
        if let Ok(json) = serde_json::to_string(&initial_event) {
            yield Ok(Event::default().data(json));
        }
        // Send current ownership info
        if let Ok(json) = serde_json::to_string(&owner_event) {
            yield Ok(Event::default().data(json));
        }

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Ok(json) = serde_json::to_string(&event) {
                        yield Ok(Event::default().data(json));
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

/// POST /api/sessions/:id/command — Send a remote playback command
pub async fn session_command(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<SessionCommandRequest>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Validate command
    let valid_actions = [
        "play",
        "pause",
        "next",
        "previous",
        "playAtIndex",
        "seek",
        "stop",
        "takeOver",
        "volumeChange",
        "setVolume",
    ];
    if !valid_actions.contains(&request.action.as_str()) {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Invalid action: {}. Valid actions: {:?}",
            request.action, valid_actions
        ))));
    }

    // On takeOver, update the session's owner to the requesting client
    if request.action == "takeOver" {
        let new_client_name = request.client_name.as_deref().unwrap_or("ferrotune-web");
        let new_client_id = request
            .client_id
            .as_deref()
            .filter(|client_id| !client_id.is_empty())
            .ok_or_else(|| {
                FerrotuneApiError(Error::InvalidRequest(
                    "clientId is required for takeOver".to_string(),
                ))
            })?;

        queries::update_session_owner(
            &state.database,
            &session_id,
            Some(new_client_id),
            new_client_name,
        )
        .await?;

        // Update queue position if provided (avoids stale position from heartbeat lag)
        if let Some(position_ms) = request.position_ms {
            let _ = queries::update_queue_position_ms_by_session(
                &state.database,
                &session_id,
                position_ms,
            )
            .await;
        }

        // Broadcast owner changed event
        state
            .session_manager
            .broadcast(
                &session_id,
                SessionEvent::OwnerChanged {
                    owner_client_id: Some(new_client_id.to_string()),
                    owner_client_name: Some(new_client_name.to_string()),
                    resume_playback: request.resume_playback.filter(|resume| *resume),
                    position_ms: request.position_ms,
                },
            )
            .await;
    }

    // Broadcast the appropriate event type
    let event = match request.action.as_str() {
        "volumeChange" => SessionEvent::VolumeChange {
            volume: request.volume.unwrap_or(1.0),
            is_muted: request.is_muted.unwrap_or(false),
            client_id: request.client_id.clone(),
        },
        "takeOver" => {
            // Already handled above — also send playback command to pause old owner
            SessionEvent::PlaybackCommand {
                action: "takeOver".to_string(),
                client_id: request.client_id.clone(),
                position_ms: request.position_ms,
                current_index: request.current_index,
                volume: request.volume,
                is_muted: request.is_muted,
            }
        }
        _ => SessionEvent::PlaybackCommand {
            action: request.action,
            client_id: request.client_id,
            position_ms: request.position_ms,
            current_index: request.current_index,
            volume: request.volume,
            is_muted: request.is_muted,
        },
    };

    state.session_manager.broadcast(&session_id, event).await;

    Ok(Json(SessionSuccessResponse { success: true }))
}

/// DELETE /api/sessions/:id/clients/:client_id — Explicitly disconnect a client.
///
/// Sent by a closing tab via `navigator.sendBeacon` so its entry disappears
/// from the connected-clients list immediately, rather than waiting for the
/// heartbeat grace period (90s) to elapse after the SSE stream drops. The
/// route also accepts the client id as a `clientId` query parameter for use
/// by `sendBeacon` calls that cannot easily set path segments.
///
/// If the disconnected client was the session owner, ownership is cleared and
/// an `OwnerChanged` event is broadcast.
pub async fn disconnect_client(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path((session_id, path_client_id)): Path<(String, String)>,
    Query(query): Query<DisconnectClientQuery>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    let path_client = if path_client_id.is_empty() {
        None
    } else {
        Some(path_client_id)
    };
    let client_id = query.client_id.clone().or(path_client).ok_or_else(|| {
        FerrotuneApiError(Error::InvalidRequest("clientId is required".to_string()))
    })?;

    detach_client(&state, &session_id, user.user_id, &client_id, true).await;

    Ok(Json(SessionSuccessResponse { success: true }))
}

/// Query params for the disconnect-client endpoint.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectClientQuery {
    pub client_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn connected_client(client_id: &str, client_name: &str) -> ConnectedClient {
        ConnectedClient {
            client_id: client_id.to_string(),
            client_name: client_name.to_string(),
            network_address: None,
            hostname: None,
            device_label: None,
            connected_at: Instant::now(),
        }
    }

    fn connected_client_with_metadata(
        client_id: &str,
        client_name: &str,
        network_address: Option<&str>,
        hostname: Option<&str>,
        device_label: Option<&str>,
    ) -> ConnectedClient {
        ConnectedClient {
            client_id: client_id.to_string(),
            client_name: client_name.to_string(),
            network_address: network_address.map(str::to_string),
            hostname: hostname.map(str::to_string),
            device_label: device_label.map(str::to_string),
            connected_at: Instant::now(),
        }
    }

    #[test]
    fn display_names_label_single_cast_client_as_chromecast_owner() {
        let clients = [connected_client("cast-1", "ferrotune-cast")];

        let responses = compute_display_names(&clients, Some("cast-1"));

        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].client_id, "cast-1");
        assert_eq!(responses[0].client_name, "ferrotune-cast");
        assert_eq!(responses[0].display_name, "Chromecast");
        assert!(responses[0].is_owner);
    }

    #[test]
    fn display_names_include_client_metadata() {
        let clients = [connected_client_with_metadata(
            "web-1",
            "ferrotune-web",
            Some("192.168.1.15"),
            Some("office.local"),
            Some("Laptop"),
        )];

        let responses = compute_display_names(&clients, Some("web-1"));

        assert_eq!(
            responses[0].network_address.as_deref(),
            Some("192.168.1.15")
        );
        assert_eq!(responses[0].hostname.as_deref(), Some("office.local"));
        assert_eq!(responses[0].network_label.as_deref(), Some("office.local"));
        assert_eq!(responses[0].device_label.as_deref(), Some("Laptop"));
    }

    #[test]
    fn display_names_fall_back_to_network_address_label() {
        let clients = [connected_client_with_metadata(
            "web-1",
            "ferrotune-web",
            Some("192.168.1.15"),
            None,
            None,
        )];

        let responses = compute_display_names(&clients, None);

        assert_eq!(responses[0].network_label.as_deref(), Some("192.168.1.15"));
    }

    #[test]
    fn display_names_number_cast_clients_independently() {
        let clients = [
            connected_client("web-1", "ferrotune-web"),
            connected_client("cast-1", "ferrotune-cast"),
            connected_client("mobile-1", "ferrotune-mobile"),
            connected_client("cast-2", "ferrotune-cast"),
        ];

        let responses = compute_display_names(&clients, Some("cast-2"));
        let display_names: Vec<&str> = responses
            .iter()
            .map(|response| response.display_name.as_str())
            .collect();

        assert_eq!(
            display_names,
            ["Web", "Chromecast 1", "Mobile", "Chromecast 2"]
        );
        assert!(!responses[1].is_owner);
        assert!(responses[3].is_owner);
    }
}
