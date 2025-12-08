//! Play Queue management endpoints for Ferrotune Admin API.
//!
//! Provides a POST-based alternative to the OpenSubsonic savePlayQueue endpoint
//! that uses JSON body instead of query parameters for better scalability with
//! large queues.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::Result;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SavePlayQueueRequest>,
) -> Result<impl IntoResponse> {
    // Use a transaction to ensure atomicity
    let mut tx = state.pool.begin().await?;

    // Delete existing queue entries for this user
    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;

    // Insert new queue entries
    for (position, song_id) in request.song_ids.iter().enumerate() {
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position) VALUES (?, ?, ?)",
        )
        .bind(user.user_id)
        .bind(song_id)
        .bind(position as i64)
        .execute(&mut *tx)
        .await?;
    }

    // Find current index from current song ID
    let current_index = request
        .current
        .as_ref()
        .and_then(|current_id| {
            request
                .song_ids
                .iter()
                .position(|id| id == current_id)
                .map(|i| i as i64)
        })
        .unwrap_or(0);

    // Upsert the queue metadata using new schema
    sqlx::query(
        "INSERT INTO play_queues (user_id, source_type, current_index, position_ms, 
         is_shuffled, repeat_mode, created_at, updated_at, changed_by)
         VALUES (?, 'other', ?, ?, 0, 'off', datetime('now'), datetime('now'), ?)
         ON CONFLICT(user_id) DO UPDATE SET
            current_index = excluded.current_index,
            position_ms = excluded.position_ms,
            updated_at = datetime('now'),
            changed_by = excluded.changed_by",
    )
    .bind(user.user_id)
    .bind(current_index)
    .bind(request.position.unwrap_or(0))
    .bind(&user.client)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::OK,
        Json(SavePlayQueueResponse { success: true }),
    ))
}
