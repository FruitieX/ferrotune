//! Server configuration API endpoints.
//!
//! This module provides endpoints for reading and updating server configuration
//! stored in the database. This allows configuring the server via the admin UI
//! without requiring a config file.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::config as config_repo;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::extract::State;
use axum::response::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

const DEFAULT_SERVER_NAME: &str = "Ferrotune";
const DEFAULT_MAX_COVER_SIZE: u32 = 1024;
const DEFAULT_READONLY_TAGS: bool = true;
const DEFAULT_ALLOW_FILE_DELETION: bool = false;
const DEFAULT_CONFIGURED: bool = false;

const KEY_SERVER_NAME: &str = "server.name";
const KEY_MAX_COVER_SIZE: &str = "cache.max_cover_size";
const KEY_READONLY_TAGS: &str = "music.readonly_tags";
const KEY_ALLOW_FILE_DELETION: &str = "music.allow_file_deletion";
const KEY_INITIAL_SETUP_COMPLETE: &str = "initial_setup_complete";

/// Server configuration response
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ServerConfigResponse {
    /// Server display name
    pub server_name: String,
    /// Server bind host
    pub server_host: String,
    /// Server port
    pub server_port: u16,
    /// Maximum cover art size in pixels
    pub max_cover_size: u32,
    /// Whether tag editing is disabled
    pub readonly_tags: bool,
    /// Whether file deletion is allowed
    pub allow_file_deletion: bool,
    /// Whether the server has been configured (first-run complete)
    pub configured: bool,
    /// Database connection target (read-only, from runtime startup config)
    pub database_path: String,
    /// Cache path (read-only, from runtime startup config)
    pub cache_path: String,
}

/// Request to update server configuration
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateServerConfigRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cover_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readonly_tags: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_file_deletion: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured: Option<bool>,
}

/// Get server configuration from database
async fn get_config_value(database: &crate::db::Database, key: &str) -> Option<String> {
    config_repo::get_config_value(database, key)
        .await
        .ok()
        .flatten()
}

/// Set server configuration value in database
async fn set_config_value(
    database: &crate::db::Database,
    key: &str,
    value: &str,
) -> FerrotuneApiResult<()> {
    config_repo::set_config_value(database, key, value)
        .await
        .map_err(|e| Error::Internal(format!("Failed to set config value: {}", e)))?;
    Ok(())
}

/// Parse JSON value from database
fn parse_json<T: serde::de::DeserializeOwned>(value: Option<String>, default: T) -> T {
    value
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(default)
}

/// Check if tag editing is enabled (reads from database, defaults to read-only).
/// This allows the toggle to apply immediately without server restart.
pub async fn is_tag_editing_enabled(state: &AppState) -> bool {
    let readonly: bool = parse_json(
        get_config_value(&state.database, KEY_READONLY_TAGS).await,
        DEFAULT_READONLY_TAGS,
    );
    !readonly
}

/// Check if file deletion is enabled (reads from database, defaults to false).
/// This controls whether users can mark and delete music files from the library.
pub async fn is_file_deletion_enabled(state: &AppState) -> bool {
    parse_json(
        get_config_value(&state.database, KEY_ALLOW_FILE_DELETION).await,
        DEFAULT_ALLOW_FILE_DELETION,
    )
}

/// Get the configured maximum cover art size in pixels.
pub async fn get_max_cover_size(state: &AppState) -> u32 {
    parse_json(
        get_config_value(&state.database, KEY_MAX_COVER_SIZE).await,
        DEFAULT_MAX_COVER_SIZE,
    )
}

/// Get server configuration
pub async fn get_server_config(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ServerConfigResponse>> {
    // Only admin users can view server config
    if !user.is_admin {
        return Err(FerrotuneApiError::from(Error::Forbidden(
            "Admin access required".to_string(),
        )));
    }

    let database = &state.database;

    let server_name = parse_json(
        get_config_value(database, KEY_SERVER_NAME).await,
        DEFAULT_SERVER_NAME.to_string(),
    );
    let max_cover_size = get_max_cover_size(&state).await;
    let readonly_tags: bool = parse_json(
        get_config_value(database, KEY_READONLY_TAGS).await,
        DEFAULT_READONLY_TAGS,
    );
    let allow_file_deletion: bool = parse_json(
        get_config_value(database, KEY_ALLOW_FILE_DELETION).await,
        DEFAULT_ALLOW_FILE_DELETION,
    );
    let configured: bool = parse_json(
        get_config_value(database, KEY_INITIAL_SETUP_COMPLETE).await,
        DEFAULT_CONFIGURED,
    );

    Ok(Json(ServerConfigResponse {
        server_name,
        server_host: state.config.server.host.clone(),
        server_port: state.config.server.port,
        max_cover_size,
        readonly_tags,
        allow_file_deletion,
        configured,
        database_path: state.config.database.connection_label(),
        cache_path: state.config.cache.path.to_string_lossy().to_string(),
    }))
}

/// Update server configuration
pub async fn update_server_config(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdateServerConfigRequest>,
) -> FerrotuneApiResult<Json<ServerConfigResponse>> {
    // Only admin users can update server config
    if !user.is_admin {
        return Err(FerrotuneApiError::from(Error::Forbidden(
            "Admin access required".to_string(),
        )));
    }

    let database = &state.database;

    // Update each provided field
    if let Some(name) = &request.server_name {
        set_config_value(
            database,
            KEY_SERVER_NAME,
            &serde_json::to_string(name).unwrap(),
        )
        .await?;
    }
    if let Some(max_cover_size) = request.max_cover_size {
        set_config_value(database, KEY_MAX_COVER_SIZE, &max_cover_size.to_string()).await?;
    }
    if let Some(readonly_tags) = request.readonly_tags {
        set_config_value(database, KEY_READONLY_TAGS, &readonly_tags.to_string()).await?;
    }
    if let Some(allow_file_deletion) = request.allow_file_deletion {
        set_config_value(
            database,
            KEY_ALLOW_FILE_DELETION,
            &allow_file_deletion.to_string(),
        )
        .await?;
    }
    if let Some(configured) = request.configured {
        set_config_value(
            database,
            KEY_INITIAL_SETUP_COMPLETE,
            &configured.to_string(),
        )
        .await?;
    }

    // Return updated config
    get_server_config(user, State(state)).await
}

/// Get all configuration as key-value pairs (for debugging/export)
pub async fn get_all_config(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<HashMap<String, serde_json::Value>>> {
    // Only admin users can view config
    if !user.is_admin {
        return Err(FerrotuneApiError::from(Error::Forbidden(
            "Admin access required".to_string(),
        )));
    }

    let rows = config_repo::get_all_config_values(&state.database)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get config: {}", e)))?;

    let config: HashMap<String, serde_json::Value> = rows
        .into_iter()
        .filter_map(|(key, value)| serde_json::from_str(&value).ok().map(|v| (key, v)))
        .collect();

    Ok(Json(config))
}
