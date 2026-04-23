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
    let setup_complete = crate::db::repo::config::is_initial_setup_complete(&state.database)
        .await
        .map_err(|e| Error::Internal(format!("Database error checking setup status: {}", e)))?;

    let user_count = crate::db::repo::users::count_users(&state.database)
        .await
        .map_err(|e| Error::Internal(format!("Database error counting users: {}", e)))?;

    let folder_count = crate::db::repo::users::count_music_folders(&state.database)
        .await
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

    crate::db::repo::config::set_initial_setup_complete(&state.database, true)
        .await
        .map_err(|e| Error::Internal(format!("Failed to update setup status: {}", e)))?;

    // Return updated status
    get_setup_status(State(state)).await
}
