//! Setup status API endpoint.
//!
//! This module provides an unauthenticated endpoint for checking if the server
//! needs initial setup. The frontend uses this to redirect to the setup wizard.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
use axum::extract::State;
use axum::response::Json;
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// Setup status response - indicates if the server needs initial setup
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SetupStatusResponse {
    /// Whether initial setup has been completed
    pub setup_complete: bool,
    /// Whether there are any users in the database
    pub has_users: bool,
    /// Whether there are any music folders configured
    pub has_music_folders: bool,
    /// Server version
    pub version: String,
}

/// Check if the server needs initial setup.
/// This endpoint is unauthenticated so the frontend can redirect appropriately.
pub async fn get_setup_status(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SetupStatusResponse>> {
    // Check if initial_setup_complete is true in server_config
    let setup_complete_raw: Option<String> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_scalar::<_, String>(
            "SELECT value FROM server_config WHERE key = 'initial_setup_complete'",
        )
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT value FROM server_config WHERE key = 'initial_setup_complete'",
        )
        .fetch_optional(state.database.postgres_pool()?)
        .await
    }
    .map_err(|e| Error::Internal(format!("Database error checking setup status: {}", e)))?;

    let setup_complete: bool = setup_complete_raw
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(false);

    // Check if there are any users
    let user_count: i64 = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(pool)
            .await
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(state.database.postgres_pool()?)
            .await
    }
    .map_err(|e| Error::Internal(format!("Database error counting users: {}", e)))?;

    // Check if there are any music folders
    let folder_count: i64 = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_scalar("SELECT COUNT(*) FROM music_folders")
            .fetch_one(pool)
            .await
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM music_folders")
            .fetch_one(state.database.postgres_pool()?)
            .await
    }
    .map_err(|e| Error::Internal(format!("Database error counting music folders: {}", e)))?;

    Ok(Json(SetupStatusResponse {
        setup_complete,
        has_users: user_count > 0,
        has_music_folders: folder_count > 0,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }))
}

/// Mark setup as complete
pub async fn complete_setup(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SetupStatusResponse>> {
    if !user.is_admin {
        return Err(Error::Forbidden("Admin privileges required".to_string()).into());
    }

    // Set initial_setup_complete to true
    if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query(
            "INSERT INTO server_config (key, value, updated_at) \
             VALUES ('initial_setup_complete', 'true', CURRENT_TIMESTAMP) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .execute(pool)
        .await
        .map(|_| ())
    } else {
        sqlx::query(
            "INSERT INTO server_config (key, value, updated_at) \
             VALUES ('initial_setup_complete', 'true', CURRENT_TIMESTAMP) \
             ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
        )
        .execute(state.database.postgres_pool()?)
        .await
        .map(|_| ())
    }
    .map_err(|e| Error::Internal(format!("Failed to update setup status: {}", e)))?;

    // Return updated status
    get_setup_status(State(state)).await
}
