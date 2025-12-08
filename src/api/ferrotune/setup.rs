//! Setup status API endpoint.
//!
//! This module provides an unauthenticated endpoint for checking if the server
//! needs initial setup. The frontend uses this to redirect to the setup wizard.

use crate::api::AppState;
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
pub async fn get_setup_status(State(state): State<Arc<AppState>>) -> Json<SetupStatusResponse> {
    let pool = &state.pool;

    // Check if initial_setup_complete is true in server_config
    let setup_complete: bool = sqlx::query_scalar::<_, String>(
        "SELECT value FROM server_config WHERE key = 'initial_setup_complete'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|v| serde_json::from_str(&v).ok())
    .unwrap_or(false);

    // Check if there are any users
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Check if there are any music folders
    let folder_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM music_folders")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    Json(SetupStatusResponse {
        setup_complete,
        has_users: user_count > 0,
        has_music_folders: folder_count > 0,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Mark setup as complete
pub async fn complete_setup(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SetupStatusResponse>, (axum::http::StatusCode, String)> {
    let pool = &state.pool;

    // Set initial_setup_complete to true
    sqlx::query(
        "INSERT OR REPLACE INTO server_config (key, value, updated_at) VALUES ('initial_setup_complete', 'true', CURRENT_TIMESTAMP)"
    )
    .execute(pool)
    .await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Return updated status
    Ok(get_setup_status(State(state)).await)
}
