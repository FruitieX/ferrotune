//! Playback session management endpoints.
//!
//! Single-session-per-user model: each user has one persistent session.
//! Multiple clients (browser tabs, app instances) connect to the same session.
//! One client is the audio owner; others are followers.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::{AppState, ConnectedClient, SessionEvent};
use crate::db::queries;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, Sse},
    Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::Arc, time::Duration};
use ts_rs::TS;

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
    pub volume: Option<f64>,
    pub is_muted: Option<bool>,
    pub client_name: Option<String>,
    pub client_id: Option<String>,
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

    // First pass: count by type
    for c in clients {
        match c.client_name.as_str() {
            "ferrotune-mobile" => mobile_count += 1,
            _ => web_count += 1,
        }
    }

    // Second pass: assign display names
    let mut web_index = 0usize;
    let mut mobile_index = 0usize;
    let mut result = Vec::with_capacity(clients.len());

    for c in clients {
        let (prefix, count, index) = match c.client_name.as_str() {
            "ferrotune-mobile" => {
                mobile_index += 1;
                ("Mobile", mobile_count, mobile_index)
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
            is_owner: owner_client_id == Some(c.client_id.as_str()),
        });
    }
    result
}

// ============================================================================
// Endpoints
// ============================================================================

/// POST /ferrotune/sessions — Connect to (or create) the user's session
pub async fn connect_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ConnectSessionRequest>,
) -> FerrotuneApiResult<Json<ConnectSessionResponse>> {
    // Check if session already exists
    let existing = queries::get_user_session(&state.pool, user.user_id).await?;
    let is_new = existing.is_none();

    let session = queries::get_or_create_session(&state.pool, user.user_id).await?;

    // Determine if the connecting client should become the owner:
    // 1. Session is brand new (just created)
    // 2. Current owner is stale (no longer connected via SSE)
    // Note: if owner_client_id is None on an existing session, it was cleared
    // intentionally (inactivity timeout) — don't auto-assign ownership, wait
    // for the client to explicitly start playback.
    let should_take_ownership = if request.client_id.is_some() {
        if is_new {
            true
        } else if let Some(ref owner_id) = session.owner_client_id {
            // Check if the current owner still has an active SSE connection
            !state
                .session_manager
                .is_client_connected(&session.id, owner_id)
                .await
        } else {
            false
        }
    } else {
        false
    };

    let (owner_client_id, owner_client_name) = if should_take_ownership {
        let client_id = request.client_id.as_ref().unwrap();
        queries::update_session_owner(
            &state.pool,
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

/// GET /ferrotune/sessions — Get the user's session info
pub async fn get_session_info(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SessionResponse>> {
    let session = queries::get_or_create_session(&state.pool, user.user_id).await?;

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

/// GET /ferrotune/sessions/clients — List connected clients
pub async fn list_clients(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ClientListResponse>> {
    let session = queries::get_or_create_session(&state.pool, user.user_id).await?;
    let clients = state.session_manager.get_clients(&session.id).await;
    let client_responses = compute_display_names(&clients, session.owner_client_id.as_deref());

    Ok(Json(ClientListResponse {
        clients: client_responses,
    }))
}

/// POST /ferrotune/sessions/:id/heartbeat — Update heartbeat + playback state
pub async fn session_heartbeat(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<HeartbeatRequest>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    queries::get_session(&state.pool, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Distinguish owner heartbeats (include song info or position) from
    // follower keepalive heartbeats (only { isPlaying: false }).
    // Only owner heartbeats should update playback state and broadcast.
    let is_owner_heartbeat = request.current_index.is_some() || request.current_song_id.is_some();

    if is_owner_heartbeat {
        queries::update_session_heartbeat_with_position(
            &state.pool,
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
        // Follower keepalive: only update the heartbeat timestamp
        queries::update_session_heartbeat_timestamp(&state.pool, &session_id).await?;
    }

    Ok(Json(SessionSuccessResponse { success: true }))
}

/// Guard that unregisters a client when the SSE stream is dropped.
struct ClientCleanupGuard {
    session_id: String,
    client_id: Option<String>,
    state: Arc<AppState>,
}

impl Drop for ClientCleanupGuard {
    fn drop(&mut self) {
        let session_id = self.session_id.clone();
        let client_id = self.client_id.clone();
        let state = self.state.clone();
        tokio::spawn(async move {
            if let Some(ref cid) = client_id {
                state
                    .session_manager
                    .unregister_client(&session_id, cid)
                    .await;
                // Notify other clients that the client list changed
                state
                    .session_manager
                    .broadcast(&session_id, SessionEvent::ClientListChanged)
                    .await;
            }
        });
    }
}

/// GET /ferrotune/sessions/:id/events — SSE stream of session events
pub async fn session_events(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Query(query): Query<SessionEventsQuery>,
) -> FerrotuneApiResult<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.pool, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Register client if client_id provided
    if let Some(ref client_id) = query.client_id {
        let client_name = query.client_name.as_deref().unwrap_or("ferrotune-web");
        state
            .session_manager
            .register_client(&session.id, client_id, client_name)
            .await;

        // Notify other clients that a new client connected
        state
            .session_manager
            .broadcast(&session.id, SessionEvent::ClientListChanged)
            .await;
    }

    let mut rx = state.session_manager.subscribe(&session.id).await;

    // Read current queue position from the database for accurate initial state
    let (current_index, position_ms) = if let Ok(Some(queue)) =
        queries::get_play_queue_by_session(&state.pool, &session.id, user.user_id).await
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
        owner_client_id: session.owner_client_id,
        owner_client_name: Some(session.owner_client_name),
    };

    // This guard is held by the stream; when axum drops the stream on client
    // disconnect, the guard's Drop impl unregisters the client.
    let _cleanup_guard = ClientCleanupGuard {
        session_id: session.id.clone(),
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

/// POST /ferrotune/sessions/:id/command — Send a remote playback command
pub async fn session_command(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<SessionCommandRequest>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    queries::get_session(&state.pool, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Validate command
    let valid_actions = [
        "play",
        "pause",
        "next",
        "previous",
        "seek",
        "stop",
        "queueChanged",
        "queueUpdated",
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
        let new_client_id = request.client_id.as_deref();

        queries::update_session_owner(&state.pool, &session_id, new_client_id, new_client_name)
            .await?;

        // Update queue position if provided (avoids stale position from heartbeat lag)
        if let Some(position_ms) = request.position_ms {
            let _ =
                queries::update_queue_position_ms_by_session(&state.pool, &session_id, position_ms)
                    .await;
        }

        // Broadcast owner changed event
        if let Some(ref cid) = request.client_id {
            state
                .session_manager
                .broadcast(
                    &session_id,
                    SessionEvent::OwnerChanged {
                        owner_client_id: Some(cid.clone()),
                        owner_client_name: Some(new_client_name.to_string()),
                    },
                )
                .await;
        }
    }

    // Broadcast the appropriate event type
    let event = match request.action.as_str() {
        "queueChanged" => SessionEvent::QueueChanged,
        "queueUpdated" => SessionEvent::QueueUpdated,
        "volumeChange" => SessionEvent::VolumeChange {
            volume: request.volume.unwrap_or(1.0),
            is_muted: request.is_muted.unwrap_or(false),
        },
        "takeOver" => {
            // Already handled above — also send playback command to pause old owner
            SessionEvent::PlaybackCommand {
                action: "takeOver".to_string(),
                position_ms: request.position_ms,
                volume: request.volume,
                is_muted: request.is_muted,
            }
        }
        _ => SessionEvent::PlaybackCommand {
            action: request.action,
            position_ms: request.position_ms,
            volume: request.volume,
            is_muted: request.is_muted,
        },
    };

    state.session_manager.broadcast(&session_id, event).await;

    Ok(Json(SessionSuccessResponse { success: true }))
}
