//! Play Queue management endpoints for Ferrotune Admin API.
//!
//! Provides a POST-based alternative to the OpenSubsonic savePlayQueue endpoint
//! that uses JSON body instead of query parameters for better scalability with
//! large queues.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::Result;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::Utc;
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

    // Upsert the queue metadata
    sqlx::query(
        "INSERT INTO play_queues (user_id, current_song_id, position, changed_at, changed_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            current_song_id = excluded.current_song_id,
            position = excluded.position,
            changed_at = excluded.changed_at,
            changed_by = excluded.changed_by",
    )
    .bind(user.user_id)
    .bind(&request.current)
    .bind(request.position.unwrap_or(0))
    .bind(Utc::now())
    .bind(&user.client)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::OK,
        Json(SavePlayQueueResponse { success: true }),
    ))
}
