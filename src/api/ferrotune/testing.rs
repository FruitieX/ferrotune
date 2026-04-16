//! Testing-only endpoints for E2E test isolation.
//!
//! These endpoints are only available when the `FERROTUNE_TESTING` environment
//! variable is set to "true". They allow tests to reset server state between
//! test runs for proper isolation.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::DatabaseHandle;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Serialize;
use std::sync::Arc;

/// Response from the reset endpoint.
#[derive(Serialize)]
pub struct ResetResponse {
    pub success: bool,
    pub message: String,
}

/// Check if testing mode is enabled via environment variable.
pub fn is_testing_enabled() -> bool {
    std::env::var("FERROTUNE_TESTING")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Reset all user-modifiable state to a clean state.
///
/// This endpoint clears:
/// - Play queues
/// - User preferences (reset to defaults)
/// - Starred items
/// - Ratings
/// - Playlists and playlist folders
/// - Smart playlists
/// - Scrobbles/play history
/// - Listening sessions
/// - Tagger sessions (tracks and pending edits)
/// - Shuffle excludes
///
/// This does NOT clear:
/// - Users (keeps test user)
/// - Music folders configuration
/// - Library data (songs, albums, artists) - these come from scanning
///
/// Requires `FERROTUNE_TESTING=true` environment variable.
pub async fn reset_state(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
) -> impl IntoResponse {
    // Guard: only allow in testing mode
    if !is_testing_enabled() {
        return (
            StatusCode::FORBIDDEN,
            Json(ResetResponse {
                success: false,
                message: "Testing endpoints are disabled. Set FERROTUNE_TESTING=true to enable."
                    .to_string(),
            }),
        );
    }

    let user_id = user.user_id;

    // Clear all user-modifiable tables for this user
    let result = reset_user_state(&state.database, user_id).await;

    match result {
        Ok(()) => (
            StatusCode::OK,
            Json(ResetResponse {
                success: true,
                message: "User state reset successfully".to_string(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ResetResponse {
                success: false,
                message: format!("Failed to reset state: {}", e),
            }),
        ),
    }
}

/// Reset all state for a specific user.
async fn reset_user_state(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
) -> Result<(), sqlx::Error> {
    let pool = database
        .sqlite_pool()
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    // Use a transaction for atomicity
    let mut tx = pool.begin().await?;

    // Clear play queue entries
    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear play queue
    sqlx::query("DELETE FROM play_queues WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Reset user preferences to defaults (delete to let defaults take effect)
    sqlx::query("DELETE FROM user_preferences WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear starred items
    sqlx::query("DELETE FROM starred WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear ratings
    sqlx::query("DELETE FROM ratings WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear playlist songs first (foreign key)
    sqlx::query(
        "DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Clear playlist shares
    sqlx::query(
        "DELETE FROM playlist_shares WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Clear playlists
    sqlx::query("DELETE FROM playlists WHERE owner_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear playlist folders
    sqlx::query("DELETE FROM playlist_folders WHERE owner_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear smart playlists
    sqlx::query("DELETE FROM smart_playlists WHERE owner_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear scrobbles
    sqlx::query("DELETE FROM scrobbles WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear listening sessions
    sqlx::query("DELETE FROM listening_sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear tagger pending edits (via session foreign key cascade)
    // First get the session ID, then delete
    sqlx::query(
        "DELETE FROM tagger_pending_edits WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = ?)",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Clear tagger session tracks
    sqlx::query(
        "DELETE FROM tagger_session_tracks WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = ?)",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Clear tagger sessions
    sqlx::query("DELETE FROM tagger_sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear shuffle excludes
    sqlx::query("DELETE FROM shuffle_excludes WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Clear playback sessions (resets session ownership so next connect gets a fresh session)
    sqlx::query("DELETE FROM playback_sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Commit transaction
    tx.commit().await?;

    tracing::info!(user_id = user_id, "Reset user state for testing");

    Ok(())
}
