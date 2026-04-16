//! Play Queue management endpoints for Ferrotune Admin API.
//!
//! Provides a POST-based alternative to the OpenSubsonic savePlayQueue endpoint
//! that uses JSON body instead of query parameters for better scalability with
//! large queues.

use crate::api::common::playqueue::find_current_index;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::FerrotuneApiResult;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Request body for saving the play queue.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlayQueueRequest {
    /// List of song IDs in the queue.
    pub song_ids: Vec<String>,
    /// ID of the currently playing song (optional).
    pub current: Option<String>,
    /// Playback position in milliseconds (optional).
    pub position: Option<i64>,
}

/// Response for successful play queue save.
#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SavePlayQueueResponse {
    pub success: bool,
}

/// POST /ferrotune/play-queue - Save the current play queue.
///
/// Uses JSON body instead of query parameters for better handling of large queues.
/// This is an alternative to the OpenSubsonic savePlayQueue endpoint.
///
/// Note: This endpoint uses the new server-side queue schema but maintains
/// compatibility with the legacy API format.
pub async fn save_play_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SavePlayQueueRequest>,
) -> FerrotuneApiResult<(StatusCode, Json<SavePlayQueueResponse>)> {
    // Use a deterministic session ID for ferrotune playqueue API
    let session_id = format!("playqueue-{}", user.user_id);

    // Find current index from current song ID
    let current_index = find_current_index(&request.song_ids, request.current.as_deref());

    crate::db::queries::create_queue_for_session(
        &state.database,
        user.user_id,
        &session_id,
        "other",
        None,
        None,
        &request.song_ids,
        None,
        current_index,
        false,
        None,
        None,
        "off",
        None,
        None,
        "ferrotune",
    )
    .await?;

    if let Some(position_ms) = request.position {
        crate::db::queries::update_queue_position_ms_by_session(
            &state.database,
            &session_id,
            position_ms,
        )
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(SavePlayQueueResponse { success: true }),
    ))
}
