//! Push wake-ups for native apps (Firebase Cloud Messaging).
//!
//! An idle phone closes its session event stream, so a "play here" from
//! another device is delivered as a push message that wakes it instead.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::push_devices;
use crate::error::{Error, FerrotuneApiResult};
use crate::push::PushOutcome;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPushDeviceRequest {
    pub client_id: String,
    pub token: String,
    pub client_name: Option<String>,
    pub device_label: Option<String>,
}

/// PUT /api/push/device — Register (or refresh) this app's push token.
pub async fn register_push_device(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterPushDeviceRequest>,
) -> FerrotuneApiResult<StatusCode> {
    if crate::push::sender().is_none() {
        return Err(Error::NotFound("Push messaging is not configured".to_string()).into());
    }
    let client_id = request.client_id.trim();
    let token = request.token.trim();
    if client_id.is_empty() || token.is_empty() {
        return Err(Error::InvalidRequest("clientId and token are required".to_string()).into());
    }
    push_devices::upsert_push_device(
        &state.database,
        user.user_id,
        client_id,
        request
            .client_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .unwrap_or("ferrotune-mobile"),
        request
            .device_label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty()),
        token,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/push/device/{client_id} — Stop waking this app (sign-out).
pub async fn unregister_push_device(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(client_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    push_devices::delete_push_device(&state.database, user.user_id, &client_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Whether a client can be woken by push: push is configured and the client
/// registered a token. Such a client stays the session owner while asleep.
pub async fn is_push_reachable(state: &AppState, user_id: i64, client_id: &str) -> bool {
    crate::push::sender().is_some()
        && matches!(
            push_devices::get_push_device(&state.database, user_id, client_id).await,
            Ok(Some(_))
        )
}

/// Wakes a registered app that a `takeOver` names but that has no open
/// session stream, so it starts playback itself. Runs in the background.
pub fn wake_for_take_over(
    state: Arc<AppState>,
    user_id: i64,
    session_id: String,
    client_id: String,
    position_ms: Option<i64>,
    resume_playback: bool,
) {
    let mut fields = vec![
        ("type", "takeOver".to_string()),
        ("resumePlayback", resume_playback.to_string()),
    ];
    if let Some(position_ms) = position_ms {
        fields.push(("positionMs", position_ms.to_string()));
    }
    wake_idle_client(state, user_id, session_id, client_id, fields);
}

/// Delivers a remote playback command (play, seek, ...) to the session owner
/// by push when it has no open session stream: an idle phone closes it, and a
/// command only broadcast on the stream would be lost.
pub fn wake_for_command(
    state: Arc<AppState>,
    user_id: i64,
    session_id: String,
    client_id: String,
    action: String,
    position_ms: Option<i64>,
    current_index: Option<usize>,
) {
    let mut fields = vec![("type", "command".to_string()), ("action", action)];
    if let Some(position_ms) = position_ms {
        fields.push(("positionMs", position_ms.to_string()));
    }
    if let Some(current_index) = current_index {
        fields.push(("currentIndex", current_index.to_string()));
    }
    wake_idle_client(state, user_id, session_id, client_id, fields);
}

/// Sends `fields` (plus the session id) as a push to `client_id` unless it
/// has an open session stream. Runs in the background.
fn wake_idle_client(
    state: Arc<AppState>,
    user_id: i64,
    session_id: String,
    client_id: String,
    fields: Vec<(&'static str, String)>,
) {
    let Some(sender) = crate::push::sender() else {
        return;
    };
    tokio::spawn(async move {
        if state
            .session_manager
            .is_client_sse_connected(&session_id, &client_id)
            .await
        {
            return;
        }
        let device = match push_devices::get_push_device(&state.database, user_id, &client_id).await
        {
            Ok(Some(device)) => device,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!("Could not look up push device {client_id}: {error}");
                return;
            }
        };

        // FCM data values are strings.
        let mut data = Map::new();
        data.insert("sessionId".into(), Value::from(session_id));
        for (key, value) in fields {
            data.insert(key.into(), Value::from(value));
        }
        let kind = data.get("action").or_else(|| data.get("type")).cloned();

        match sender.send_data(&device.token, data).await {
            Ok(PushOutcome::Sent) => {
                tracing::info!(client_id, kind = ?kind, "Woke idle client with a push");
            }
            Ok(PushOutcome::TokenRejected) => {
                tracing::info!(client_id, "Dropping push device whose token FCM rejected");
                if let Err(error) =
                    push_devices::delete_push_devices_with_token(&state.database, &device.token)
                        .await
                {
                    tracing::warn!("Could not drop rejected push token: {error}");
                }
            }
            Err(error) => tracing::warn!(client_id, "Push wake-up failed: {error}"),
        }
    });
}
