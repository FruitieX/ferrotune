//! Playback session management endpoints.
//!
//! Provides CRUD for playback sessions, heartbeat, SSE event streaming,
//! and remote playback command dispatch.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::{AppState, SessionEvent};
use crate::db::queries;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
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
pub struct CreateSessionRequest {
    #[serde(default = "default_client_name")]
    pub client_name: String,
}

fn default_client_name() -> String {
    "ferrotune-web".to_string()
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionResponse {
    pub id: String,
    pub name: String,
    pub client_name: String,
    pub is_playing: bool,
    pub current_song_id: Option<String>,
    pub current_song_title: Option<String>,
    pub current_song_artist: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionListResponse {
    pub sessions: Vec<SessionResponse>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateSessionResponse {
    pub id: String,
    pub name: String,
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
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionSuccessResponse {
    pub success: bool,
}

// ============================================================================
// Endpoints
// ============================================================================

/// POST /ferrotune/sessions — Create a new playback session
pub async fn create_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateSessionRequest>,
) -> FerrotuneApiResult<Json<CreateSessionResponse>> {
    let count = queries::count_active_sessions(&state.pool, user.user_id).await?;
    let prefix = match request.client_name.as_str() {
        "ferrotune-mobile" => "Mobile",
        _ => "Web",
    };
    let name = format!("{} {}", prefix, count + 1);

    let id =
        queries::create_playback_session(&state.pool, user.user_id, &name, &request.client_name)
            .await?;

    // Notify all existing sessions that the session list changed
    let sessions = queries::get_active_sessions(&state.pool, user.user_id).await?;
    let session_ids: Vec<String> = sessions.into_iter().map(|s| s.id).collect();
    state
        .session_manager
        .broadcast_to_sessions(&session_ids, SessionEvent::SessionListChanged)
        .await;

    Ok(Json(CreateSessionResponse { id, name }))
}

/// GET /ferrotune/sessions — List active sessions for current user
pub async fn list_sessions(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SessionListResponse>> {
    let sessions = queries::get_active_sessions(&state.pool, user.user_id).await?;

    let responses: Vec<SessionResponse> = sessions
        .into_iter()
        .map(|s| SessionResponse {
            id: s.id,
            name: s.name,
            client_name: s.client_name,
            is_playing: s.is_playing,
            current_song_id: s.current_song_id,
            current_song_title: s.current_song_title,
            current_song_artist: s.current_song_artist,
            created_at: s.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(SessionListResponse {
        sessions: responses,
    }))
}

/// DELETE /ferrotune/sessions/:id — End a session
pub async fn delete_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.pool, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Broadcast SessionEnded to listeners
    state
        .session_manager
        .broadcast(&session.id, SessionEvent::SessionEnded)
        .await;
    state.session_manager.remove(&session.id).await;

    queries::delete_session(&state.pool, &session_id).await?;

    // Notify remaining sessions that the session list changed
    let sessions = queries::get_active_sessions(&state.pool, user.user_id).await?;
    let session_ids: Vec<String> = sessions.into_iter().map(|s| s.id).collect();
    state
        .session_manager
        .broadcast_to_sessions(&session_ids, SessionEvent::SessionListChanged)
        .await;

    Ok(Json(SessionSuccessResponse { success: true }))
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
        queries::update_session_heartbeat(
            &state.pool,
            &session_id,
            request.is_playing,
            request.current_song_id.as_deref(),
            request.current_song_title.as_deref(),
            request.current_song_artist.as_deref(),
        )
        .await?;

        // Also update queue position if provided
        if let (Some(current_index), Some(position_ms)) =
            (request.current_index, request.position_ms)
        {
            let _ = queries::update_queue_position_by_session(
                &state.pool,
                &session_id,
                current_index as i64,
                position_ms,
            )
            .await;
        }

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

/// Guard that auto-deletes a session when dropped if no SSE subscribers remain.
struct SessionCleanupGuard {
    session_id: String,
    user_id: i64,
    state: Arc<AppState>,
}

impl Drop for SessionCleanupGuard {
    fn drop(&mut self) {
        let session_id = self.session_id.clone();
        let user_id = self.user_id;
        let state = self.state.clone();
        tokio::spawn(async move {
            // Small delay so the receiver is fully released before checking count
            tokio::time::sleep(Duration::from_millis(100)).await;
            let remaining = state.session_manager.receiver_count(&session_id).await;
            if remaining == 0 {
                tracing::debug!(
                    "Session {} has no remaining subscribers, auto-deleting",
                    session_id
                );
                state.session_manager.remove(&session_id).await;
                let _ = queries::delete_session(&state.pool, &session_id).await;

                // Notify remaining sessions for this user
                if let Ok(sessions) = queries::get_active_sessions(&state.pool, user_id).await {
                    let session_ids: Vec<String> = sessions.into_iter().map(|s| s.id).collect();
                    state
                        .session_manager
                        .broadcast_to_sessions(&session_ids, SessionEvent::SessionListChanged)
                        .await;
                }
            }
        });
    }
}

/// GET /ferrotune/sessions/:id/events — SSE stream of session events
pub async fn session_events(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> FerrotuneApiResult<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.pool, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    let mut rx = state.session_manager.subscribe(&session.id).await;

    // Read current queue position from the database for accurate initial state
    let (current_index, position_ms) = if let Ok(Some(queue)) =
        queries::get_play_queue_by_session(&state.pool, &session.id).await
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

    // This guard is held by the stream; when axum drops the stream on client
    // disconnect, the guard's Drop impl checks if the session should be
    // auto-deleted (no remaining SSE subscribers).
    let _cleanup_guard = SessionCleanupGuard {
        session_id: session.id.clone(),
        user_id: user.user_id,
        state: state.clone(),
    };

    let stream = async_stream::stream! {
        let _guard = _cleanup_guard;

        // Send initial state
        if let Ok(json) = serde_json::to_string(&initial_event) {
            yield Ok(Event::default().data(json));
        }

        loop {
            match rx.recv().await {
                Ok(event) => {
                    let is_ended = matches!(event, SessionEvent::SessionEnded);
                    if let Ok(json) = serde_json::to_string(&event) {
                        yield Ok(Event::default().data(json));
                    }
                    if is_ended {
                        break;
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

    // Broadcast the appropriate event type
    let event = match request.action.as_str() {
        "queueChanged" => SessionEvent::QueueChanged,
        "queueUpdated" => SessionEvent::QueueUpdated,
        "volumeChange" => SessionEvent::VolumeChange {
            volume: request.volume.unwrap_or(1.0),
            is_muted: request.is_muted.unwrap_or(false),
        },
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
