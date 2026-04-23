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
    use crate::db::entity;
    use sea_orm::{
        ColumnTrait, EntityTrait, QueryFilter, QuerySelect, QueryTrait, TransactionTrait,
    };

    let tx = database.conn().begin().await?;

    // Simple `DELETE FROM t WHERE user_id = ?` tables.
    entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::play_queues::Entity::delete_many()
        .filter(entity::play_queues::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::user_preferences::Entity::delete_many()
        .filter(entity::user_preferences::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::starred::Entity::delete_many()
        .filter(entity::starred::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::ratings::Entity::delete_many()
        .filter(entity::ratings::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;

    // Playlist fan-out: owner_id -> playlists, then their songs/shares.
    let owned_playlists_subq = entity::playlists::Entity::find()
        .select_only()
        .column(entity::playlists::Column::Id)
        .filter(entity::playlists::Column::OwnerId.eq(user_id))
        .into_query();
    entity::playlist_songs::Entity::delete_many()
        .filter(
            entity::playlist_songs::Column::PlaylistId.in_subquery(owned_playlists_subq.clone()),
        )
        .exec(&tx)
        .await?;
    entity::playlist_shares::Entity::delete_many()
        .filter(entity::playlist_shares::Column::PlaylistId.in_subquery(owned_playlists_subq))
        .exec(&tx)
        .await?;
    entity::playlists::Entity::delete_many()
        .filter(entity::playlists::Column::OwnerId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::playlist_folders::Entity::delete_many()
        .filter(entity::playlist_folders::Column::OwnerId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::smart_playlists::Entity::delete_many()
        .filter(entity::smart_playlists::Column::OwnerId.eq(user_id))
        .exec(&tx)
        .await?;

    entity::scrobbles::Entity::delete_many()
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::listening_sessions::Entity::delete_many()
        .filter(entity::listening_sessions::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;

    // Tagger sessions fan-out.
    let owned_tagger_subq = entity::tagger_sessions::Entity::find()
        .select_only()
        .column(entity::tagger_sessions::Column::Id)
        .filter(entity::tagger_sessions::Column::UserId.eq(user_id))
        .into_query();
    entity::tagger_pending_edits::Entity::delete_many()
        .filter(
            entity::tagger_pending_edits::Column::SessionId.in_subquery(owned_tagger_subq.clone()),
        )
        .exec(&tx)
        .await?;
    entity::tagger_session_tracks::Entity::delete_many()
        .filter(entity::tagger_session_tracks::Column::SessionId.in_subquery(owned_tagger_subq))
        .exec(&tx)
        .await?;
    entity::tagger_sessions::Entity::delete_many()
        .filter(entity::tagger_sessions::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;

    entity::shuffle_excludes::Entity::delete_many()
        .filter(entity::shuffle_excludes::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;
    entity::playback_sessions::Entity::delete_many()
        .filter(entity::playback_sessions::Column::UserId.eq(user_id))
        .exec(&tx)
        .await?;

    tx.commit().await?;

    tracing::info!(user_id = user_id, "Reset user state for testing");

    Ok(())
}
