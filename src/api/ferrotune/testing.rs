//! Testing-only endpoints for E2E test isolation.
//!
//! These endpoints are only available when the `FERROTUNE_TESTING` environment
//! variable is set to "true". They allow tests to reset server state between
//! test runs for proper isolation.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
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
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<()> {
    use sea_orm::TransactionTrait;
    let tx = database.conn().begin().await?;

    let pairs: [(&str, &str); 17] = [
        (
            "DELETE FROM play_queue_entries WHERE user_id = ?",
            "DELETE FROM play_queue_entries WHERE user_id = $1",
        ),
        (
            "DELETE FROM play_queues WHERE user_id = ?",
            "DELETE FROM play_queues WHERE user_id = $1",
        ),
        (
            "DELETE FROM user_preferences WHERE user_id = ?",
            "DELETE FROM user_preferences WHERE user_id = $1",
        ),
        (
            "DELETE FROM starred WHERE user_id = ?",
            "DELETE FROM starred WHERE user_id = $1",
        ),
        (
            "DELETE FROM ratings WHERE user_id = ?",
            "DELETE FROM ratings WHERE user_id = $1",
        ),
        (
            "DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)",
            "DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = $1)",
        ),
        (
            "DELETE FROM playlist_shares WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)",
            "DELETE FROM playlist_shares WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = $1)",
        ),
        (
            "DELETE FROM playlists WHERE owner_id = ?",
            "DELETE FROM playlists WHERE owner_id = $1",
        ),
        (
            "DELETE FROM playlist_folders WHERE owner_id = ?",
            "DELETE FROM playlist_folders WHERE owner_id = $1",
        ),
        (
            "DELETE FROM smart_playlists WHERE owner_id = ?",
            "DELETE FROM smart_playlists WHERE owner_id = $1",
        ),
        (
            "DELETE FROM scrobbles WHERE user_id = ?",
            "DELETE FROM scrobbles WHERE user_id = $1",
        ),
        (
            "DELETE FROM listening_sessions WHERE user_id = ?",
            "DELETE FROM listening_sessions WHERE user_id = $1",
        ),
        (
            "DELETE FROM tagger_pending_edits WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = ?)",
            "DELETE FROM tagger_pending_edits WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = $1)",
        ),
        (
            "DELETE FROM tagger_session_tracks WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = ?)",
            "DELETE FROM tagger_session_tracks WHERE session_id IN (SELECT id FROM tagger_sessions WHERE user_id = $1)",
        ),
        (
            "DELETE FROM tagger_sessions WHERE user_id = ?",
            "DELETE FROM tagger_sessions WHERE user_id = $1",
        ),
        (
            "DELETE FROM shuffle_excludes WHERE user_id = ?",
            "DELETE FROM shuffle_excludes WHERE user_id = $1",
        ),
        (
            "DELETE FROM playback_sessions WHERE user_id = ?",
            "DELETE FROM playback_sessions WHERE user_id = $1",
        ),
    ];

    for (sqlite_sql, postgres_sql) in pairs {
        crate::db::raw::execute(
            &tx,
            sqlite_sql,
            postgres_sql,
            [sea_orm::Value::from(user_id)],
        )
        .await?;
    }

    tx.commit().await?;

    tracing::info!(user_id = user_id, "Reset user state for testing");

    Ok(())
}
