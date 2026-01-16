//! Server configuration API endpoints.
//!
//! This module provides endpoints for reading and updating server configuration
//! stored in the database. This allows configuring the server via the admin UI
//! without requiring a config file.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::extract::State;
use axum::response::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

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
    /// Default admin username (for display only)
    pub admin_user: String,
    /// Maximum cover art size in pixels
    pub max_cover_size: u32,
    /// Whether tag editing is disabled
    pub readonly_tags: bool,
    /// Whether file deletion is allowed
    pub allow_file_deletion: bool,
    /// Whether the server has been configured (first-run complete)
    pub configured: bool,
    /// Database path (read-only, from config file or default)
    pub database_path: String,
    /// Cache path (read-only, from config file or default)
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
    pub server_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_password: Option<String>,
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
async fn get_config_value(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM server_config WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Set server configuration value in database
async fn set_config_value(
    pool: &sqlx::SqlitePool,
    key: &str,
    value: &str,
) -> FerrotuneApiResult<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO server_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
    )
    .bind(key)
    .bind(value)
    .execute(pool)
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

/// Check if tag editing is enabled (reads from database, falls back to startup config).
/// This allows the toggle to apply immediately without server restart.
pub async fn is_tag_editing_enabled(state: &AppState) -> bool {
    // Check database first for dynamic config
    let db_value = get_config_value(&state.pool, "music.readonly_tags").await;
    if let Some(val) = db_value {
        // Database has an explicit value - use it
        let readonly: bool = parse_json(Some(val), state.config.music.readonly_tags);
        return !readonly;
    }
    // Fall back to startup config value
    !state.config.music.readonly_tags
}

/// Check if file deletion is enabled (reads from database, defaults to false).
/// This controls whether users can mark and delete music files from the library.
pub async fn is_file_deletion_enabled(state: &AppState) -> bool {
    let db_value = get_config_value(&state.pool, "music.allow_file_deletion").await;
    parse_json(db_value, false)
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

    let pool = &state.pool;

    let server_name = parse_json(
        get_config_value(pool, "server.name").await,
        "Ferrotune".to_string(),
    );
    let server_host = parse_json(
        get_config_value(pool, "server.host").await,
        "127.0.0.1".to_string(),
    );
    let server_port: u16 = parse_json(get_config_value(pool, "server.port").await, 4040);
    let admin_user = parse_json(
        get_config_value(pool, "server.admin_user").await,
        "admin".to_string(),
    );
    let max_cover_size: u32 =
        parse_json(get_config_value(pool, "cache.max_cover_size").await, 1024);
    // Use config file value as default for readonly_tags (consistent with is_tag_editing_enabled)
    let readonly_tags: bool = parse_json(
        get_config_value(pool, "music.readonly_tags").await,
        state.config.music.readonly_tags,
    );
    let allow_file_deletion: bool = parse_json(
        get_config_value(pool, "music.allow_file_deletion").await,
        false,
    );
    let configured: bool = parse_json(get_config_value(pool, "configured").await, false);

    Ok(Json(ServerConfigResponse {
        server_name,
        server_host,
        server_port,
        admin_user,
        max_cover_size,
        readonly_tags,
        allow_file_deletion,
        configured,
        database_path: state.config.database.path.to_string_lossy().to_string(),
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

    let pool = &state.pool;

    // Update each provided field
    if let Some(name) = &request.server_name {
        set_config_value(pool, "server.name", &serde_json::to_string(name).unwrap()).await?;
    }
    if let Some(host) = &request.server_host {
        set_config_value(pool, "server.host", &serde_json::to_string(host).unwrap()).await?;
    }
    if let Some(port) = request.server_port {
        set_config_value(pool, "server.port", &port.to_string()).await?;
    }
    if let Some(admin_user) = &request.admin_user {
        set_config_value(
            pool,
            "server.admin_user",
            &serde_json::to_string(admin_user).unwrap(),
        )
        .await?;
    }
    if let Some(admin_password) = &request.admin_password {
        set_config_value(
            pool,
            "server.admin_password",
            &serde_json::to_string(admin_password).unwrap(),
        )
        .await?;
    }
    if let Some(max_cover_size) = request.max_cover_size {
        set_config_value(pool, "cache.max_cover_size", &max_cover_size.to_string()).await?;
    }
    if let Some(readonly_tags) = request.readonly_tags {
        set_config_value(pool, "music.readonly_tags", &readonly_tags.to_string()).await?;
    }
    if let Some(allow_file_deletion) = request.allow_file_deletion {
        set_config_value(
            pool,
            "music.allow_file_deletion",
            &allow_file_deletion.to_string(),
        )
        .await?;
    }
    if let Some(configured) = request.configured {
        set_config_value(pool, "configured", &configured.to_string()).await?;
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

    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM server_config")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get config: {}", e)))?;

    let config: HashMap<String, serde_json::Value> = rows
        .into_iter()
        .filter_map(|(key, value)| serde_json::from_str(&value).ok().map(|v| (key, v)))
        .collect();

    Ok(Json(config))
}
