//! Playback session management endpoints.
//!
//! Single-session-per-user model: each user has one persistent session.
//! Multiple clients (browser tabs, app instances) connect to the same session.
//! One client is the audio owner; others are followers.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::{
    AppState, ConnectedClient, ConnectedClientMetadata, DiagnosticsBundle, SessionEvent,
};
use crate::db::queries;
use crate::db::repo::push_devices::{self, PushDevice};
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, Sse},
    Extension, Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};
use ts_rs::TS;
use uuid::Uuid;

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
    /// A native app with no open session stream that a push message can wake;
    /// transferring playback to it starts playback there.
    pub is_idle: bool,
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
    /// Set when a `takeOver` hands playback to another device: if that device
    /// is an idle native app, the server wakes it with a push message. Not set
    /// when a client claims playback for itself.
    #[serde(default)]
    pub wake_target: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionSuccessResponse {
    pub success: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsPullRequest {
    /// The app to ask. Defaults to the user's only Android app (or, with
    /// several, the session owner).
    pub client_id: Option<String>,
    /// Seconds to wait for the upload before answering `202 pending`
    /// (default 45, at most 120). The upload is kept for an hour either way.
    pub wait_secs: Option<u64>,
    /// Upload at most this many bytes of the newest logs (default: all of
    /// them, up to 12 MiB).
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticsStatus {
    Complete,
    Pending,
}

/// The state of a diagnostics pull: `202` while the app has not uploaded.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsPullResponse {
    pub request_id: String,
    pub client_id: String,
    pub status: DiagnosticsStatus,
    /// How the request reached the app: "stream" and/or "push".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub delivered_via: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle: Option<DiagnosticsBundle>,
}

const DEFAULT_DIAGNOSTICS_WAIT: Duration = Duration::from_secs(45);
const MAX_DIAGNOSTICS_WAIT: Duration = Duration::from_secs(120);
/// How long an upload may take over an open session stream before the
/// request is also pushed: a stream can look open after its connection died.
const DIAGNOSTICS_STREAM_FALLBACK_DELAY: Duration = Duration::from_secs(8);
const MAX_DIAGNOSTICS_BYTES: usize = 12 * 1024 * 1024;
const ANDROID_CLIENT_NAME: &str = "ferrotune-mobile";

/// Query params for SSE events endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventsQuery {
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub device_label: Option<String>,
    /// Seconds between keep-alive comments. Mobile clients ask for minutes:
    /// each keep-alive wakes the phone's radio. Clamped to
    /// [`SSE_KEEP_ALIVE_RANGE`].
    pub keep_alive_secs: Option<u64>,
}

/// Default and allowed keep-alive intervals for session event streams. The
/// upper bound stays below Envoy's 5-minute stream idle timeout.
const SSE_KEEP_ALIVE_DEFAULT_SECS: u64 = 15;
const SSE_KEEP_ALIVE_RANGE: std::ops::RangeInclusive<u64> = 15..=240;

fn sse_keep_alive_interval(requested_secs: Option<u64>) -> Duration {
    let secs = requested_secs
        .unwrap_or(SSE_KEEP_ALIVE_DEFAULT_SECS)
        .clamp(*SSE_KEEP_ALIVE_RANGE.start(), *SSE_KEEP_ALIVE_RANGE.end());
    Duration::from_secs(secs)
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
            is_idle: false,
        });
    }
    result
}

/// Registered push devices that are not connected right now: idle native apps
/// that transferring playback to wakes with a push message.
fn idle_push_clients(
    devices: &[PushDevice],
    connected: &[ClientResponse],
    owner_client_id: Option<&str>,
) -> Vec<ClientResponse> {
    devices
        .iter()
        .filter(|device| {
            !connected
                .iter()
                .any(|client| client.client_id == device.client_id)
        })
        .map(|device| ClientResponse {
            client_id: device.client_id.clone(),
            client_name: device.client_name.clone(),
            display_name: "Mobile".to_string(),
            network_address: None,
            hostname: None,
            network_label: None,
            device_label: device.device_label.clone(),
            is_owner: owner_client_id == Some(device.client_id.as_str()),
            is_idle: true,
        })
        .collect()
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

    let new_owner = request.client_id.as_ref().filter(|_| is_new);
    let (owner_client_id, owner_client_name) = if let Some(client_id) = new_owner {
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
    let mut client_responses = compute_display_names(&clients, session.owner_client_id.as_deref());
    if crate::push::sender().is_some() {
        let devices = push_devices::list_push_devices(&state.database, user.user_id).await?;
        let idle = idle_push_clients(
            &devices,
            &client_responses,
            session.owner_client_id.as_deref(),
        );
        client_responses.extend(idle);
    }

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
    let owner_client_id = session
        .as_ref()
        .and_then(|session| session.owner_client_id.as_deref());
    let is_owner = owner_client_id == Some(client_id);
    let owner_heartbeat_fresh = if is_owner {
        state
            .session_manager
            .is_client_heartbeat_fresh(session_id, client_id)
            .await
    } else {
        false
    };
    let had_live_sse = if is_owner {
        state
            .session_manager
            .is_client_sse_connected(session_id, client_id)
            .await
    } else {
        false
    };

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

    tracing::debug!(
        target: "session_ownership",
        session_id,
        client_id,
        force,
        is_owner,
        owner_heartbeat_fresh,
        had_live_sse,
        removed,
        db_is_playing = session.as_ref().map(|value| value.is_playing),
        db_last_heartbeat = ?session.as_ref().map(|value| value.last_heartbeat),
        db_last_playing_at = ?session.as_ref().and_then(|value| value.last_playing_at),
        "Evaluated SSE client detach"
    );

    if !removed {
        if is_owner {
            tracing::debug!(
                target: "session_ownership",
                session_id,
                client_id,
                force,
                owner_heartbeat_fresh,
                had_live_sse,
                "Preserved logical owner after SSE detach"
            );
        }
        return;
    }

    // A native app asleep with its stream closed can still be woken by push,
    // so it keeps ownership (the idle-owner sweep frees the session later).
    let owner_push_reachable = is_owner
        && !force
        && super::push_devices::is_push_reachable(state, user_id, client_id).await;
    if owner_push_reachable {
        tracing::info!(
            client_id,
            "Kept a push-reachable owner after its session stream closed"
        );
    }

    let owner_cleared = if is_owner && !owner_push_reachable {
        match queries::clear_session_owner(&state.database, session_id).await {
            Ok(cleared) => {
                tracing::warn!(
                    target: "session_ownership",
                    session_id,
                    client_id,
                    force,
                    owner_heartbeat_fresh,
                    had_live_sse,
                    owner_cleared = cleared,
                    "Cleared owner after SSE client removal"
                );
                cleared
            }
            Err(error) => {
                tracing::error!(
                    target: "session_ownership",
                    session_id,
                    client_id,
                    force,
                    owner_heartbeat_fresh,
                    had_live_sse,
                    error = %error,
                    "Failed to clear owner after SSE client removal"
                );
                false
            }
        }
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

/// POST /api/sessions/:id/diagnostics — Ask the Android app to upload its
/// logs. Reaches it over its session stream when open and by push otherwise
/// (or when the stream stays silent), so an idle phone answers too. Answers
/// `202 pending` if the upload hasn't arrived within `waitSecs`; fetch it
/// later with `GET /api/sessions/:id/diagnostics/:request_id`.
pub async fn request_android_diagnostics(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    request: Option<Json<DiagnosticsPullRequest>>,
) -> FerrotuneApiResult<(StatusCode, Json<DiagnosticsPullResponse>)> {
    let request = request.map(|Json(request)| request).unwrap_or_default();
    let session = queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    let push_enabled = crate::push::sender().is_some();
    let devices = if push_enabled {
        push_devices::list_push_devices(&state.database, user.user_id).await?
    } else {
        Vec::new()
    };
    let connected = state.session_manager.get_clients(&session_id).await;
    let client_id = diagnostics_target(
        request.client_id.as_deref(),
        &connected,
        &devices,
        session.owner_client_id.as_deref(),
    )?;
    let stream_open = state
        .session_manager
        .is_client_sse_connected(&session_id, &client_id)
        .await;
    let pushable = devices.iter().any(|device| device.client_id == client_id);
    if !stream_open && !pushable {
        return Err(FerrotuneApiError(Error::Conflict(
            "The app has no open session stream and no push registration".to_string(),
        )));
    }

    let wait = request
        .wait_secs
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_DIAGNOSTICS_WAIT)
        .min(MAX_DIAGNOSTICS_WAIT);
    let deadline = tokio::time::Instant::now() + wait;
    let request_id = Uuid::new_v4().to_string();
    let mut upload = state
        .session_manager
        .register_diagnostics_request(request_id.clone(), session_id.clone(), client_id.clone())
        .await;

    let mut delivered_via = Vec::new();
    if stream_open {
        state
            .session_manager
            .broadcast(
                &session_id,
                SessionEvent::DiagnosticsRequest {
                    request_id: request_id.clone(),
                    client_id: client_id.clone(),
                    max_bytes: request.max_bytes,
                },
            )
            .await;
        delivered_via.push("stream");
    }
    let uploaded_over_stream = stream_open
        && wait_for_diagnostics(
            &mut upload,
            (tokio::time::Instant::now() + DIAGNOSTICS_STREAM_FALLBACK_DELAY).min(deadline),
        )
        .await;
    if !uploaded_over_stream && pushable {
        match super::push_devices::push_diagnostics_request(
            &state,
            user.user_id,
            &session_id,
            &client_id,
            &request_id,
            request.max_bytes,
        )
        .await
        {
            Ok(()) => delivered_via.push("push"),
            Err(error) if delivered_via.is_empty() => {
                return Err(FerrotuneApiError(Error::Conflict(format!(
                    "Could not reach the app by push: {error}"
                ))));
            }
            Err(error) => tracing::warn!(client_id, "Diagnostics push failed: {error}"),
        }
    }
    wait_for_diagnostics(&mut upload, deadline).await;

    let bundle = upload.borrow().as_deref().cloned();
    Ok(diagnostics_response(
        request_id,
        client_id,
        delivered_via,
        bundle,
    ))
}

/// GET /api/sessions/:id/diagnostics/:request_id — The upload of an earlier
/// diagnostics pull (kept for an hour), or `202 pending`.
pub async fn get_android_diagnostics(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path((session_id, request_id)): Path<(String, String)>,
) -> FerrotuneApiResult<(StatusCode, Json<DiagnosticsPullResponse>)> {
    queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;
    let upload = state
        .session_manager
        .diagnostics_upload(&request_id, &session_id)
        .await
        .ok_or_else(|| Error::NotFound("Diagnostics request not found or expired".to_string()))?;
    let bundle = upload.borrow().as_deref().cloned();
    let client_id = bundle
        .as_ref()
        .map(|bundle| bundle.client_id.clone())
        .unwrap_or_default();
    Ok(diagnostics_response(
        request_id,
        client_id,
        Vec::new(),
        bundle,
    ))
}

/// Picks the app a diagnostics pull asks: the named client, else the only
/// Android app connected or registered for push, else the session owner
/// among several.
fn diagnostics_target(
    requested: Option<&str>,
    connected: &[ConnectedClient],
    devices: &[PushDevice],
    owner_client_id: Option<&str>,
) -> Result<String, Error> {
    let mut candidates: Vec<&str> = connected
        .iter()
        .filter(|client| client.client_name == ANDROID_CLIENT_NAME)
        .map(|client| client.client_id.as_str())
        .chain(
            devices
                .iter()
                .filter(|device| device.client_name == ANDROID_CLIENT_NAME)
                .map(|device| device.client_id.as_str()),
        )
        .collect();
    candidates.sort_unstable();
    candidates.dedup();

    if let Some(requested) = requested {
        return if candidates.contains(&requested) {
            Ok(requested.to_string())
        } else {
            Err(Error::NotFound(
                "No Android app with that client id is connected or registered for push"
                    .to_string(),
            ))
        };
    }
    match candidates.as_slice() {
        [] => Err(Error::NotFound(
            "No Android app is connected or registered for push".to_string(),
        )),
        [only] => Ok(only.to_string()),
        several => owner_client_id
            .filter(|owner| several.contains(owner))
            .map(str::to_string)
            .ok_or_else(|| {
                Error::InvalidRequest(format!(
                    "Several Android apps found; pass clientId (one of: {})",
                    several.join(", ")
                ))
            }),
    }
}

/// Waits until the app has uploaded or `deadline` passes; true if uploaded.
async fn wait_for_diagnostics(
    upload: &mut crate::api::DiagnosticsUpload,
    deadline: tokio::time::Instant,
) -> bool {
    matches!(
        tokio::time::timeout_at(deadline, upload.wait_for(Option::is_some)).await,
        Ok(Ok(_))
    )
}

fn diagnostics_response(
    request_id: String,
    client_id: String,
    delivered_via: Vec<&'static str>,
    bundle: Option<DiagnosticsBundle>,
) -> (StatusCode, Json<DiagnosticsPullResponse>) {
    let (status_code, status) = if bundle.is_some() {
        (StatusCode::OK, DiagnosticsStatus::Complete)
    } else {
        (StatusCode::ACCEPTED, DiagnosticsStatus::Pending)
    };
    (
        status_code,
        Json(DiagnosticsPullResponse {
            request_id,
            client_id,
            status,
            delivered_via,
            bundle,
        }),
    )
}

/// POST /api/sessions/:id/diagnostics/:request_id — Upload a diagnostics bundle.
pub async fn upload_android_diagnostics(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path((session_id, request_id)): Path<(String, String)>,
    Json(bundle): Json<DiagnosticsBundle>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    queries::get_session(&state.database, &session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    if bundle.request_id != request_id || bundle.client_id.is_empty() {
        return Err(FerrotuneApiError(Error::InvalidRequest(
            "Diagnostics request metadata does not match the upload endpoint".to_string(),
        )));
    }

    let total_bytes = bundle
        .files
        .iter()
        .map(|file| file.content.len())
        .sum::<usize>();
    if total_bytes > MAX_DIAGNOSTICS_BYTES {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Diagnostics bundle exceeds the {} MiB limit",
            MAX_DIAGNOSTICS_BYTES / (1024 * 1024)
        ))));
    }

    let bundle_client_id = bundle.client_id.clone();
    if !state
        .session_manager
        .complete_diagnostics_request(&request_id, &session_id, &bundle_client_id, bundle)
        .await
    {
        return Err(FerrotuneApiError(Error::NotFound(
            "Diagnostics request not found or target mismatch".to_string(),
        )));
    }

    Ok(Json(SessionSuccessResponse { success: true }))
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
    let initial_event = state
        .session_manager
        .latest_position_update(&session.id)
        .await
        .unwrap_or(SessionEvent::PositionUpdate {
            current_index,
            position_ms,
            is_playing: session.is_playing,
            current_song_id: session.current_song_id,
            current_song_title: session.current_song_title,
            current_song_artist: session.current_song_artist,
        });

    // Send current ownership info so reconnecting clients can correct stale
    // isAudioOwner state (e.g. after the background inactivity timeout cleared
    // ownership while the client's SSE was disconnected).
    if session.owner_client_id.is_none() {
        tracing::warn!(
            target: "session_ownership",
            session_id = %session.id,
            reconnecting_client_id = ?query.client_id,
            reconnecting_client_name = ?query.client_name,
            db_is_playing = session.is_playing,
            db_last_heartbeat = %session.last_heartbeat,
            db_last_playing_at = ?session.last_playing_at,
            "Sending ownerless initial snapshot to SSE client"
        );
    } else {
        tracing::debug!(
            target: "session_ownership",
            session_id = %session.id,
            reconnecting_client_id = ?query.client_id,
            owner_client_id = ?session.owner_client_id,
            db_is_playing = session.is_playing,
            "Sending current owner initial snapshot to SSE client"
        );
    }

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

        // Send current ownership info first: a client only applies the
        // position snapshot below when it knows it is not the audio owner, and
        // a fresh tab starts out assuming it is.
        if let Ok(json) = serde_json::to_string(&owner_event) {
            yield Ok(Event::default().data(json));
        }
        // Send initial state
        if let Ok(json) = serde_json::to_string(&initial_event) {
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
            .interval(sse_keep_alive_interval(query.keep_alive_secs))
            .text("keep-alive"),
    ))
}

/// Commands meant for the current owner's player (not ownership or volume).
fn is_owner_playback_command(action: &str) -> bool {
    matches!(
        action,
        "play" | "pause" | "next" | "previous" | "playAtIndex" | "seek" | "stop"
    )
}

/// POST /api/sessions/:id/command — Send a remote playback command
pub async fn session_command(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(request): Json<SessionCommandRequest>,
) -> FerrotuneApiResult<Json<SessionSuccessResponse>> {
    // Verify session belongs to user
    let session = queries::get_session(&state.database, &session_id, user.user_id)
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

        tracing::info!(
            target: "session_ownership",
            session_id,
            client_id = new_client_id,
            client_name = new_client_name,
            position_ms = ?request.position_ms,
            resume_playback = ?request.resume_playback,
            "Processing explicit session ownership claim"
        );

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

        if request.wake_target {
            super::push_devices::wake_for_take_over(
                state.clone(),
                user.user_id,
                session_id.clone(),
                new_client_id.to_string(),
                request.position_ms,
                request.resume_playback.unwrap_or(false),
            );
        }
    }

    // An idle phone owner has no session stream to receive the command on;
    // wake it with a push carrying the command instead.
    if let Some(owner_client_id) = session.owner_client_id.clone() {
        if is_owner_playback_command(&request.action) {
            super::push_devices::wake_for_command(
                state.clone(),
                user.user_id,
                session_id.clone(),
                owner_client_id,
                request.action.clone(),
                request.position_ms,
                request.current_index,
            );
        }
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

    #[test]
    fn sse_keep_alive_defaults_to_fifteen_seconds_and_clamps_requests() {
        assert_eq!(sse_keep_alive_interval(None), Duration::from_secs(15));
        assert_eq!(sse_keep_alive_interval(Some(240)), Duration::from_secs(240));
        assert_eq!(sse_keep_alive_interval(Some(1)), Duration::from_secs(15));
        // Envoy drops streams idle for 5 minutes.
        assert_eq!(
            sse_keep_alive_interval(Some(3600)),
            Duration::from_secs(240)
        );
    }

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
    fn only_player_commands_wake_an_idle_owner() {
        for action in [
            "play",
            "pause",
            "next",
            "previous",
            "playAtIndex",
            "seek",
            "stop",
        ] {
            assert!(is_owner_playback_command(action), "{action}");
        }
        for action in ["takeOver", "volumeChange", "setVolume"] {
            assert!(!is_owner_playback_command(action), "{action}");
        }
    }

    #[test]
    fn registered_devices_without_a_session_stream_are_listed_as_idle() {
        let connected = compute_display_names(
            &[connected_client("web-1", "ferrotune-web")],
            Some("phone-1"),
        );
        let device = |client_id: &str| PushDevice {
            id: 1,
            user_id: 1,
            client_id: client_id.to_string(),
            client_name: "ferrotune-mobile".to_string(),
            device_label: Some("Pixel 10 Pro".to_string()),
            token: "token".to_string(),
            updated_at: chrono::Utc::now().fixed_offset(),
        };

        let idle = idle_push_clients(
            &[device("phone-1"), device("web-1")],
            &connected,
            Some("phone-1"),
        );

        assert_eq!(idle.len(), 1);
        assert_eq!(idle[0].client_id, "phone-1");
        assert!(idle[0].is_idle);
        assert!(idle[0].is_owner);
        assert_eq!(idle[0].device_label.as_deref(), Some("Pixel 10 Pro"));
        assert!(!connected[0].is_idle);
    }

    #[test]
    fn diagnostics_go_to_the_only_android_app_or_the_owner() {
        let device = |client_id: &str| PushDevice {
            id: 1,
            user_id: 1,
            client_id: client_id.to_string(),
            client_name: "ferrotune-mobile".to_string(),
            device_label: None,
            token: "token".to_string(),
            updated_at: chrono::Utc::now().fixed_offset(),
        };
        let web = connected_client("web-1", "ferrotune-web");
        let phone = connected_client("phone-1", "ferrotune-mobile");

        // An idle phone known only by its push registration is found.
        assert_eq!(
            diagnostics_target(None, std::slice::from_ref(&web), &[device("phone-1")], None).ok(),
            Some("phone-1".to_string())
        );
        // Connected and registered at once is still one app.
        assert_eq!(
            diagnostics_target(
                None,
                std::slice::from_ref(&phone),
                &[device("phone-1")],
                None
            )
            .ok(),
            Some("phone-1".to_string())
        );
        // Several apps: the owner, else the caller must choose.
        let several = [device("phone-1"), device("phone-2")];
        assert_eq!(
            diagnostics_target(None, &[], &several, Some("phone-2")).ok(),
            Some("phone-2".to_string())
        );
        assert!(matches!(
            diagnostics_target(None, &[], &several, Some("web-1")),
            Err(Error::InvalidRequest(_))
        ));
        assert_eq!(
            diagnostics_target(Some("phone-1"), &[], &several, None).ok(),
            Some("phone-1".to_string())
        );
        // Web clients are never asked, and unknown ids are not found.
        assert!(matches!(
            diagnostics_target(Some("web-1"), std::slice::from_ref(&web), &[], None),
            Err(Error::NotFound(_))
        ));
        assert!(matches!(
            diagnostics_target(None, &[web], &[], None),
            Err(Error::NotFound(_))
        ));
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
