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
    use crate::db::raw;

    // Check if initial_setup_complete is true in server_config
    let setup_complete_raw: Option<String> = raw::query_scalar::<String>(
        state.database.conn(),
        "SELECT value FROM server_config WHERE key = 'initial_setup_complete'",
        "SELECT value FROM server_config WHERE key = 'initial_setup_complete'",
        std::iter::empty::<sea_orm::Value>(),
    )
    .await
    .map_err(|e| Error::Internal(format!("Database error checking setup status: {}", e)))?;

    let setup_complete: bool = setup_complete_raw
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(false);

    // Check if there are any users
    let user_count: i64 = raw::query_scalar::<i64>(
        state.database.conn(),
        "SELECT COUNT(*) FROM users",
        "SELECT COUNT(*) FROM users",
        std::iter::empty::<sea_orm::Value>(),
    )
    .await
    .map_err(|e| Error::Internal(format!("Database error counting users: {}", e)))?
    .unwrap_or(0);

    // Check if there are any music folders
    let folder_count: i64 = raw::query_scalar::<i64>(
        state.database.conn(),
        "SELECT COUNT(*) FROM music_folders",
        "SELECT COUNT(*) FROM music_folders",
        std::iter::empty::<sea_orm::Value>(),
    )
    .await
    .map_err(|e| Error::Internal(format!("Database error counting music folders: {}", e)))?
    .unwrap_or(0);

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
    crate::db::raw::execute(
        state.database.conn(),
        "INSERT INTO server_config (key, value, updated_at) \
         VALUES ('initial_setup_complete', 'true', CURRENT_TIMESTAMP) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        "INSERT INTO server_config (key, value, updated_at) \
         VALUES ('initial_setup_complete', 'true', CURRENT_TIMESTAMP) \
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
        std::iter::empty::<sea_orm::Value>(),
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to update setup status: {}", e)))?;

    // Return updated status
    get_setup_status(State(state)).await
}
