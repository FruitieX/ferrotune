//! Tagger Session API endpoints - Database-backed session storage
//!
//! This module provides endpoints for persisting tagger session state
//! in the database instead of preferences.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use ts_rs::TS;

use super::ErrorResponse;

// =============================================================================
// Default Tagger Scripts (embedded at compile time)
// =============================================================================

/// Default rename script: AlbumArtist/Album/Artist - Title
pub const DEFAULT_SCRIPT_RENAME_ARTIST_TITLE: &str =
    include_str!("../../../scripts/tagger/rename_albumartist_album_artist_title.js");

/// Default rename script: AlbumArtist/Album/NN - Title (Picard-style)
pub const DEFAULT_SCRIPT_RENAME_TRACKNUM_TITLE: &str =
    include_str!("../../../scripts/tagger/rename_albumartist_album_tracknum_title.js");

/// Default tags script: Parse Artist - Title from filename
pub const DEFAULT_SCRIPT_PARSE_ARTIST_TITLE: &str =
    include_str!("../../../scripts/tagger/parse_artist_title.js");

/// Default tags script: Parse NN - Artist - Title from filename
pub const DEFAULT_SCRIPT_PARSE_TRACKNUM_ARTIST_TITLE: &str =
    include_str!("../../../scripts/tagger/parse_tracknum_artist_title.js");

/// Default tags script: Trim whitespace from tags
pub const DEFAULT_SCRIPT_TRIM_WHITESPACE: &str =
    include_str!("../../../scripts/tagger/trim_whitespace.js");

// =============================================================================
// Request/Response Types
// =============================================================================

/// Track entry with type information
#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerTrackEntry {
    /// Track ID
    pub id: String,
    /// Track type: 'library' or 'staged'
    pub track_type: String,
}

/// Tagger session state from API
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerSessionResponse {
    /// Tracks currently in the session with their types
    pub tracks: Vec<TaggerTrackEntry>,
    /// Visible column keys
    pub visible_columns: Vec<String>,
    /// Active rename script ID
    pub active_rename_script_id: Option<String>,
    /// Active tag script ID
    pub active_tag_script_id: Option<String>,
    /// Target library ID for uploaded files
    pub target_library_id: Option<String>,
    /// Whether to show library path prefix
    pub show_library_prefix: bool,
    /// Whether to show computed path
    pub show_computed_path: bool,
    /// Column widths
    pub column_widths: HashMap<String, i64>,
    /// File column width
    #[ts(type = "number")]
    pub file_column_width: i64,
    /// Details panel open state
    pub details_panel_open: bool,
    /// How to handle dangerous characters: 'ignore', 'strip', or 'replace'
    pub dangerous_char_mode: String,
    /// Character to replace dangerous characters with
    pub dangerous_char_replacement: String,
}

/// Request to update session settings
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateTaggerSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_rename_script_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tag_script_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_library_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_library_prefix: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_computed_path: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_widths: Option<HashMap<String, i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub file_column_width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details_panel_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dangerous_char_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dangerous_char_replacement: Option<String>,
}

/// Request to set session tracks
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SetTaggerTracksRequest {
    /// Tracks to set with their types (replaces existing)
    pub tracks: Vec<TaggerTrackEntry>,
}

/// Pending edit for a track
#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerPendingEditData {
    /// Edited tags
    pub edited_tags: HashMap<String, String>,
    /// Computed path from rename script
    pub computed_path: Option<String>,
    /// Whether cover art was removed
    pub cover_art_removed: bool,
    /// Whether this edit has cover art to fetch via GET /cover endpoint
    pub has_cover_art: bool,
}

/// Pending edit data without cover art (for update requests where cover is uploaded separately)
#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdatePendingEditRequest {
    /// Edited tags
    pub edited_tags: HashMap<String, String>,
    /// Computed path from rename script
    pub computed_path: Option<String>,
    /// Whether cover art was removed (use DELETE /cover endpoint to remove)
    #[serde(default)]
    pub cover_art_removed: bool,
}

/// Response for pending edits
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerPendingEditsResponse {
    /// Map of track_id -> pending edit data
    pub edits: HashMap<String, TaggerPendingEditData>,
}

/// Request to add tracks to session
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AddTracksRequest {
    /// Tracks to add with their types
    pub tracks: Vec<TaggerTrackEntry>,
}

/// Request to remove tracks from session
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RemoveTracksRequest {
    /// Track IDs to remove
    pub track_ids: Vec<String>,
}

/// Cover art upload response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CoverArtUploadResponse {
    /// Whether the upload was successful
    pub success: bool,
}

/// Script from the API
#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerScriptData {
    pub id: String,
    pub name: String,
    /// 'rename' or 'tags'
    #[serde(rename = "type")]
    pub script_type: String,
    pub script: String,
}

/// Response for scripts list
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerScriptsResponse {
    pub scripts: Vec<TaggerScriptData>,
}

/// Request to create/update a script
#[allow(dead_code)] // Used for TypeScript type generation
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveTaggerScriptRequest {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub script_type: String,
    pub script: String,
}

/// Row struct for pending edits query (to avoid clippy type_complexity)
#[derive(sqlx::FromRow)]
struct PendingEditRow {
    #[allow(dead_code)]
    id: i64,
    #[allow(dead_code)]
    session_id: i64,
    track_id: String,
    edited_tags: String,
    computed_path: Option<String>,
    cover_art_removed: bool,
    cover_art_filename: Option<String>,
    #[allow(dead_code)]
    created_at: String,
    #[allow(dead_code)]
    updated_at: String,
}

/// Request to save pending edits for specific tracks
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SavePendingEditsRequest {
    /// Track IDs to save (must have pending edits)
    pub track_ids: Vec<String>,
    /// Optional path overrides for conflict resolution (track_id -> new path)
    /// Used when user resolves rename conflicts in the save dialog
    #[serde(default)]
    pub path_overrides: HashMap<String, String>,
    /// Target music folder ID for staged files (required if saving staged files)
    pub target_music_folder_id: Option<i64>,
}

/// Response for save pending edits
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SavePendingEditsResponse {
    /// Whether all saves were successful
    pub success: bool,
    /// Number of tracks successfully saved
    pub saved_count: i32,
    /// Errors for individual tracks
    pub errors: Vec<SaveError>,
    /// Whether a library rescan is recommended (if key tags changed)
    pub rescan_recommended: bool,
    /// New relative paths for staged files that were saved to library (for rescanning)
    pub new_song_paths: Vec<String>,
}

/// Error for a single track save
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveError {
    pub track_id: String,
    pub error: String,
}

// =============================================================================
// Database Helpers
// =============================================================================

/// Get cover art directory for a user
fn get_cover_art_dir(username: &str) -> PathBuf {
    crate::config::get_data_dir()
        .join("staging")
        .join(username)
        .join("cover_art")
}

/// Get the mime type extension for a file
fn mime_to_extension(mime: &str) -> &str {
    match mime {
        "image/png" => ".png",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        _ => ".jpg",
    }
}

/// Seed default scripts for a new user
async fn seed_default_scripts(pool: &sqlx::SqlitePool, user_id: i64) -> Result<(), sqlx::Error> {
    // Check if user already has scripts
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tagger_scripts WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    if count.0 > 0 {
        return Ok(()); // User already has scripts
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Script 1: AlbumArtist/Album/Artist - Title (rename)
    sqlx::query(
        r#"INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(format!("default-rename-{}", user_id))
    .bind(user_id)
    .bind("AlbumArtist/Album/Artist - Title")
    .bind("rename")
    .bind(DEFAULT_SCRIPT_RENAME_ARTIST_TITLE)
    .bind(0i64)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    // Script 2: AlbumArtist/Album/NN - Title (rename)
    sqlx::query(
        r#"INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(format!("default-rename-tracknum-{}", user_id))
    .bind(user_id)
    .bind("AlbumArtist/Album/NN - Title")
    .bind("rename")
    .bind(DEFAULT_SCRIPT_RENAME_TRACKNUM_TITLE)
    .bind(1i64)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    // Script 3: Parse: Artist - Title (tags)
    sqlx::query(
        r#"INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(format!("default-parse-artist-title-{}", user_id))
    .bind(user_id)
    .bind("Parse: Artist - Title")
    .bind("tags")
    .bind(DEFAULT_SCRIPT_PARSE_ARTIST_TITLE)
    .bind(2i64)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    // Script 4: Parse: NN - Artist - Title (tags)
    sqlx::query(
        r#"INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(format!("default-parse-tracknum-{}", user_id))
    .bind(user_id)
    .bind("Parse: NN - Artist - Title")
    .bind("tags")
    .bind(DEFAULT_SCRIPT_PARSE_TRACKNUM_ARTIST_TITLE)
    .bind(3i64)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    // Script 5: Trim Whitespace (tags)
    sqlx::query(
        r#"INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(format!("default-trim-{}", user_id))
    .bind(user_id)
    .bind("Trim Whitespace")
    .bind("tags")
    .bind(DEFAULT_SCRIPT_TRIM_WHITESPACE)
    .bind(4i64)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get or create a tagger session for the user
pub async fn get_or_create_session(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<i64, sqlx::Error> {
    // Try to get existing session
    let session: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM tagger_sessions WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if let Some((id,)) = session {
        return Ok(id);
    }

    // Create new session with defaults
    let result = sqlx::query(
        r#"
        INSERT INTO tagger_sessions (user_id)
        VALUES (?)
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    // Seed default scripts for new users
    if let Err(e) = seed_default_scripts(pool, user_id).await {
        tracing::warn!("Failed to seed default scripts for user {}: {}", user_id, e);
    }

    Ok(result.last_insert_rowid())
}

// =============================================================================
// Session Endpoints
// =============================================================================

/// GET /ferrotune/tagger/session
///
/// Get the current user's tagger session state
pub async fn get_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Get session data
    let session: Option<crate::db::models::TaggerSession> = match sqlx::query_as(
        r#"
        SELECT id, user_id, active_rename_script_id, active_tag_script_id,
               target_library_id, visible_columns, column_widths, file_column_width,
               show_library_prefix, show_computed_path, details_panel_open,
               dangerous_char_mode, dangerous_char_replacement,
               created_at, updated_at
        FROM tagger_sessions WHERE id = ?
        "#,
    )
    .bind(session_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to fetch session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let session = match session {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new("Session not found")),
            )
                .into_response();
        }
    };

    // Get tracks with types
    let track_rows: Vec<(String, String)> = match sqlx::query_as(
        "SELECT track_id, track_type FROM tagger_session_tracks WHERE session_id = ? ORDER BY position",
    )
    .bind(session_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to fetch tracks",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let tracks: Vec<TaggerTrackEntry> = track_rows
        .into_iter()
        .map(|(id, track_type)| TaggerTrackEntry { id, track_type })
        .collect();

    // Parse JSON fields
    let visible_columns: Vec<String> = serde_json::from_str(&session.visible_columns)
        .unwrap_or_else(|_| {
            vec![
                "TITLE".to_string(),
                "ARTIST".to_string(),
                "ALBUM".to_string(),
                "ALBUMARTIST".to_string(),
                "TRACKNUMBER".to_string(),
                "DISCNUMBER".to_string(),
                "YEAR".to_string(),
                "GENRE".to_string(),
            ]
        });

    let column_widths: HashMap<String, i64> =
        serde_json::from_str(&session.column_widths).unwrap_or_default();

    Json(TaggerSessionResponse {
        tracks,
        visible_columns,
        active_rename_script_id: session.active_rename_script_id,
        active_tag_script_id: session.active_tag_script_id,
        target_library_id: session.target_library_id,
        show_library_prefix: session.show_library_prefix,
        show_computed_path: session.show_computed_path,
        column_widths,
        file_column_width: session.file_column_width,
        details_panel_open: session.details_panel_open,
        dangerous_char_mode: session.dangerous_char_mode,
        dangerous_char_replacement: session.dangerous_char_replacement,
    })
    .into_response()
}

/// PATCH /ferrotune/tagger/session
///
/// Update the current user's tagger session settings
pub async fn update_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdateTaggerSessionRequest>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Build dynamic update query
    let mut updates = Vec::new();
    let mut values: Vec<Box<dyn std::any::Any + Send + Sync>> = Vec::new();

    if let Some(ref cols) = request.visible_columns {
        updates.push("visible_columns = ?");
        values.push(Box::new(serde_json::to_string(cols).unwrap_or_default()));
    }
    if let Some(ref id) = request.active_rename_script_id {
        updates.push("active_rename_script_id = ?");
        values.push(Box::new(id.clone()));
    }
    if let Some(ref id) = request.active_tag_script_id {
        updates.push("active_tag_script_id = ?");
        values.push(Box::new(id.clone()));
    }
    if let Some(ref id) = request.target_library_id {
        updates.push("target_library_id = ?");
        values.push(Box::new(id.clone()));
    }
    if let Some(show) = request.show_library_prefix {
        updates.push("show_library_prefix = ?");
        values.push(Box::new(show));
    }
    if let Some(show) = request.show_computed_path {
        updates.push("show_computed_path = ?");
        values.push(Box::new(show));
    }
    if let Some(ref widths) = request.column_widths {
        updates.push("column_widths = ?");
        values.push(Box::new(serde_json::to_string(widths).unwrap_or_default()));
    }
    if let Some(width) = request.file_column_width {
        updates.push("file_column_width = ?");
        values.push(Box::new(width));
    }
    if let Some(open) = request.details_panel_open {
        updates.push("details_panel_open = ?");
        values.push(Box::new(open));
    }
    if let Some(ref mode) = request.dangerous_char_mode {
        updates.push("dangerous_char_mode = ?");
        values.push(Box::new(mode.clone()));
    }
    if let Some(ref replacement) = request.dangerous_char_replacement {
        updates.push("dangerous_char_replacement = ?");
        values.push(Box::new(replacement.clone()));
    }

    if updates.is_empty() {
        return StatusCode::NO_CONTENT.into_response();
    }

    updates.push("updated_at = ?");

    // Note: We use individual updates below since sqlx doesn't support dynamic binding easily
    let _query = format!(
        "UPDATE tagger_sessions SET {} WHERE id = ?",
        updates.join(", ")
    );

    // Execute with a simpler approach - rebuild per field
    // Since sqlx doesn't support dynamic binding easily, we'll do individual updates
    if let Some(ref cols) = request.visible_columns {
        let _ = sqlx::query("UPDATE tagger_sessions SET visible_columns = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(serde_json::to_string(cols).unwrap_or_default())
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(ref id) = request.active_rename_script_id {
        // Empty string means clear to NULL
        let value_to_bind: Option<&str> = if id.is_empty() { None } else { Some(id) };
        let _ = sqlx::query("UPDATE tagger_sessions SET active_rename_script_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(value_to_bind)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(ref id) = request.active_tag_script_id {
        // Empty string means clear to NULL
        let value_to_bind: Option<&str> = if id.is_empty() { None } else { Some(id) };
        let _ = sqlx::query("UPDATE tagger_sessions SET active_tag_script_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(value_to_bind)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if request.target_library_id.is_some() {
        let _ = sqlx::query("UPDATE tagger_sessions SET target_library_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&request.target_library_id)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(show) = request.show_library_prefix {
        let _ = sqlx::query("UPDATE tagger_sessions SET show_library_prefix = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(show)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(show) = request.show_computed_path {
        let _ = sqlx::query("UPDATE tagger_sessions SET show_computed_path = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(show)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(ref widths) = request.column_widths {
        let _ = sqlx::query("UPDATE tagger_sessions SET column_widths = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(serde_json::to_string(widths).unwrap_or_default())
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(width) = request.file_column_width {
        let _ = sqlx::query("UPDATE tagger_sessions SET file_column_width = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(width)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(open) = request.details_panel_open {
        let _ = sqlx::query("UPDATE tagger_sessions SET details_panel_open = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(open)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(ref mode) = request.dangerous_char_mode {
        let _ = sqlx::query("UPDATE tagger_sessions SET dangerous_char_mode = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }
    if let Some(ref replacement) = request.dangerous_char_replacement {
        let _ = sqlx::query("UPDATE tagger_sessions SET dangerous_char_replacement = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(replacement)
            .bind(session_id)
            .execute(&state.pool)
            .await;
    }

    StatusCode::NO_CONTENT.into_response()
}

/// PUT /ferrotune/tagger/session/tracks
///
/// Set the tracks in the current session (replaces existing)
pub async fn set_session_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetTaggerTracksRequest>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Delete existing tracks
    if let Err(e) = sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to clear tracks",
                e.to_string(),
            )),
        )
            .into_response();
    }

    // Insert new tracks
    for (position, track) in request.tracks.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO tagger_session_tracks (session_id, track_id, track_type, position) VALUES (?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(&track.id)
        .bind(&track.track_type)
        .bind(position as i64)
        .execute(&state.pool)
        .await
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to add track",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    }

    StatusCode::NO_CONTENT.into_response()
}

// =============================================================================
// Pending Edits Endpoints
// =============================================================================

/// GET /ferrotune/tagger/session/edits
///
/// Get all pending edits for the current session
pub async fn get_pending_edits(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Query pending edits
    let edits: Vec<PendingEditRow> = match sqlx::query_as(
        r#"
        SELECT id, session_id, track_id, edited_tags, computed_path,
               cover_art_removed, cover_art_filename, created_at, updated_at
        FROM tagger_pending_edits WHERE session_id = ?
        "#,
    )
    .bind(session_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(e) => e,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to fetch edits",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let mut edits_map = HashMap::new();
    for edit in edits {
        let edited_tags: HashMap<String, String> =
            serde_json::from_str(&edit.edited_tags).unwrap_or_default();

        // has_cover_art is true if there's a cover art filename set
        let has_cover_art = edit.cover_art_filename.is_some();

        edits_map.insert(
            edit.track_id.clone(),
            TaggerPendingEditData {
                edited_tags,
                computed_path: edit.computed_path.clone(),
                cover_art_removed: edit.cover_art_removed,
                has_cover_art,
            },
        );
    }

    Json(TaggerPendingEditsResponse { edits: edits_map }).into_response()
}

// NOTE: Bulk PUT /ferrotune/tagger/session/edits was removed.
// Use individual PUT /ferrotune/tagger/session/edits/:track_id for each track.

/// DELETE /ferrotune/tagger/session/edits
///
/// Clear all pending edits for the current session (also cleans up cover art files)
pub async fn clear_pending_edits(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Get cover art filenames before deleting
    let cover_art_filenames: Vec<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND cover_art_filename IS NOT NULL",
    )
    .bind(session_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Delete the edits
    if let Err(e) = sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to clear edits",
                e.to_string(),
            )),
        )
            .into_response();
    }

    // Clean up cover art files
    let cover_art_dir = get_cover_art_dir(&user.username);
    for (filename,) in cover_art_filenames {
        if let Some(filename) = filename {
            let _ = fs::remove_file(cover_art_dir.join(&filename)).await;
        }
    }

    StatusCode::NO_CONTENT.into_response()
}

/// PUT /ferrotune/tagger/session/edits/:track_id
///
/// Update or create a pending edit for a single track (upsert)
pub async fn update_edit(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
    Json(request): Json<UpdatePendingEditRequest>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let edited_tags_json = serde_json::to_string(&request.edited_tags).unwrap_or_default();
    let now = Utc::now().to_rfc3339();

    // Look up the track_type from tagger_session_tracks
    let track_type: String = match sqlx::query_scalar(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(t)) => t,
        Ok(None) => "library".to_string(), // Default to library if track not found
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to lookup track type",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Upsert the edit (INSERT OR REPLACE)
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO tagger_pending_edits 
        (session_id, track_id, track_type, edited_tags, computed_path, cover_art_removed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, track_id) DO UPDATE SET
            edited_tags = excluded.edited_tags,
            computed_path = excluded.computed_path,
            cover_art_removed = excluded.cover_art_removed,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(session_id)
    .bind(&track_id)
    .bind(&track_type)
    .bind(&edited_tags_json)
    .bind(&request.computed_path)
    .bind(request.cover_art_removed)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details("Failed to save edit", e.to_string())),
        )
            .into_response();
    }

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /ferrotune/tagger/session/edits/:track_id
///
/// Delete a pending edit for a single track
pub async fn delete_edit(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    if let Err(e) =
        sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
            .bind(session_id)
            .bind(&track_id)
            .execute(&state.pool)
            .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to delete edit",
                e.to_string(),
            )),
        )
            .into_response();
    }

    StatusCode::NO_CONTENT.into_response()
}

/// POST /ferrotune/tagger/session/tracks
///
/// Add tracks to the session (append)
pub async fn add_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<AddTracksRequest>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Get current max position
    let max_pos: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(position), -1) FROM tagger_session_tracks WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or((-1,));

    let mut position = max_pos.0 + 1;

    // Insert new tracks (skip duplicates)
    for track in request.tracks {
        match sqlx::query(
            "INSERT OR IGNORE INTO tagger_session_tracks (session_id, track_id, track_type, position) VALUES (?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(&track.id)
        .bind(&track.track_type)
        .bind(position)
        .execute(&state.pool)
        .await
        {
            Ok(result) => {
                if result.rows_affected() > 0 {
                    position += 1;
                }
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse::with_details("Failed to add track", e.to_string())),
                )
                    .into_response();
            }
        }
    }

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /ferrotune/tagger/session/tracks/:track_id
///
/// Remove a single track from the session
pub async fn remove_track(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Delete the track
    if let Err(e) =
        sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
            .bind(session_id)
            .bind(&track_id)
            .execute(&state.pool)
            .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to remove track",
                e.to_string(),
            )),
        )
            .into_response();
    }

    // Also delete any pending edit for this track
    let _ = sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
        .bind(session_id)
        .bind(&track_id)
        .execute(&state.pool)
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// POST /ferrotune/tagger/session/tracks/remove
///
/// Remove multiple tracks from the session (also cleans up cover art and staged files)
pub async fn remove_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RemoveTracksRequest>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let cover_art_dir = get_cover_art_dir(&user.username);
    let staging_dir = crate::config::get_data_dir()
        .join("staging")
        .join(&user.username);

    for track_id in &request.track_ids {
        // Get track type and cover art filename before deleting
        let track_info: Option<(String, Option<String>)> = sqlx::query_as(
            r#"SELECT t.track_type, e.cover_art_filename 
               FROM tagger_session_tracks t 
               LEFT JOIN tagger_pending_edits e ON t.session_id = e.session_id AND t.track_id = e.track_id
               WHERE t.session_id = ? AND t.track_id = ?"#,
        )
        .bind(session_id)
        .bind(track_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        if let Some((track_type, cover_art_filename)) = track_info {
            // Clean up cover art file if it exists
            if let Some(filename) = cover_art_filename {
                let _ = fs::remove_file(cover_art_dir.join(&filename)).await;
            }

            // If this is a staged track, also clean up the staged audio file
            if track_type == "staged" {
                // Get the staging path from tagger_staged_files
                if let Ok(Some((staging_path,))) = sqlx::query_as::<_, (String,)>(
                    "SELECT staging_path FROM tagger_staged_files WHERE id = ? AND user_id = ?",
                )
                .bind(track_id)
                .bind(&user.username)
                .fetch_optional(&state.pool)
                .await
                {
                    // Delete the staged audio file
                    let full_path = staging_dir.join(&staging_path);
                    let _ = fs::remove_file(&full_path).await;

                    // Delete the staged file database record
                    let _ =
                        sqlx::query("DELETE FROM tagger_staged_files WHERE id = ? AND user_id = ?")
                            .bind(track_id)
                            .bind(&user.username)
                            .execute(&state.pool)
                            .await;
                }
            }
        }

        // Delete the track from session
        let _ =
            sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(&state.pool)
                .await;

        // Also delete any pending edit
        let _ =
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(&state.pool)
                .await;
    }

    StatusCode::NO_CONTENT.into_response()
}

/// PUT /ferrotune/tagger/session/edits/:track_id/cover
///
/// Upload cover art for a track (multipart binary)
/// Cover art is stored as files with UUID filenames in the staging directory
pub async fn upload_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
    mut multipart: axum::extract::Multipart,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Extract the file from multipart
    let (data, mime_type) = match multipart.next_field().await {
        Ok(Some(field)) => {
            let content_type = field
                .content_type()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());

            match field.bytes().await {
                Ok(bytes) => (bytes.to_vec(), content_type),
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse::with_details(
                            "Failed to read file",
                            e.to_string(),
                        )),
                    )
                        .into_response();
                }
            }
        }
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("No file provided")),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::with_details(
                    "Failed to parse multipart",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Ensure cover art directory exists
    let cover_art_dir = get_cover_art_dir(&user.username);
    if let Err(e) = fs::create_dir_all(&cover_art_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to create cover art directory",
                e.to_string(),
            )),
        )
            .into_response();
    }

    // Get existing cover art filename to clean up
    let existing_filename: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    // Delete old cover art file if exists
    if let Some((Some(old_filename),)) = existing_filename {
        let old_path = cover_art_dir.join(&old_filename);
        let _ = fs::remove_file(&old_path).await;
    }

    // Generate UUID filename with extension
    let ext = mime_to_extension(&mime_type);
    let uuid = uuid::Uuid::new_v4();
    let filename = format!("{}{}", uuid, ext);
    let cover_art_path = cover_art_dir.join(&filename);

    // Write the new cover art file
    match fs::File::create(&cover_art_path).await {
        Ok(mut file) => {
            if let Err(e) = file.write_all(&data).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse::with_details(
                        "Failed to write cover art file",
                        e.to_string(),
                    )),
                )
                    .into_response();
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to create cover art file",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    }

    // Look up the track_type from tagger_session_tracks
    let track_type: String = sqlx::query_scalar(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "library".to_string());

    // Update the database with the filename
    let now = Utc::now().to_rfc3339();
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO tagger_pending_edits 
        (session_id, track_id, track_type, edited_tags, cover_art_filename, cover_art_removed, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, 0, ?, ?)
        ON CONFLICT(session_id, track_id) DO UPDATE SET
            cover_art_filename = excluded.cover_art_filename,
            cover_art_removed = 0,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(session_id)
    .bind(&track_id)
    .bind(&track_type)
    .bind(&filename)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    {
        // Clean up the file we just wrote
        let _ = fs::remove_file(&cover_art_path).await;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details("Failed to update cover art metadata", e.to_string())),
        )
            .into_response();
    }

    Json(CoverArtUploadResponse { success: true }).into_response()
}

/// DELETE /ferrotune/tagger/session/edits/:track_id/cover
///
/// Remove cover art for a track (marks as removed and deletes file)
pub async fn delete_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Get and delete the cover art file
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    if let Some((Some(filename),)) = existing {
        let cover_art_dir = get_cover_art_dir(&user.username);
        let _ = fs::remove_file(cover_art_dir.join(&filename)).await;
    }

    // Look up the track_type from tagger_session_tracks
    let track_type: String = sqlx::query_scalar(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "library".to_string());

    let now = Utc::now().to_rfc3339();

    // Upsert to mark cover art as removed and clear the filename
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO tagger_pending_edits 
        (session_id, track_id, track_type, edited_tags, cover_art_filename, cover_art_removed, created_at, updated_at)
        VALUES (?, ?, ?, '{}', NULL, 1, ?, ?)
        ON CONFLICT(session_id, track_id) DO UPDATE SET
            cover_art_filename = NULL,
            cover_art_removed = 1,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(session_id)
    .bind(&track_id)
    .bind(&track_type)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details("Failed to remove cover art", e.to_string())),
        )
            .into_response();
    }

    StatusCode::NO_CONTENT.into_response()
}

/// GET /ferrotune/tagger/session/edits/:track_id/cover
///
/// Get cover art for a track (returns binary image from file)
pub async fn get_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Get cover art filename from database
    let result: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let filename = match result {
        Some((Some(f),)) => f,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    // Determine mime type from extension
    let mime_type = if filename.ends_with(".png") {
        "image/png"
    } else if filename.ends_with(".gif") {
        "image/gif"
    } else if filename.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };

    // Read the file
    let cover_art_path = get_cover_art_dir(&user.username).join(&filename);
    match fs::read(&cover_art_path).await {
        Ok(data) => (
            [
                (axum::http::header::CONTENT_TYPE, mime_type.to_string()),
                (axum::http::header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            data,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// =============================================================================
// Scripts Endpoints
// =============================================================================

/// GET /ferrotune/tagger/scripts
///
/// Get all scripts for the current user
pub async fn get_scripts(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let scripts: Vec<crate::db::models::TaggerScript> = match sqlx::query_as(
        r#"
        SELECT id, user_id, name, type, script, position, created_at, updated_at
        FROM tagger_scripts WHERE user_id = ? ORDER BY position
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to fetch scripts",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let scripts_data: Vec<TaggerScriptData> = scripts
        .into_iter()
        .map(|s| TaggerScriptData {
            id: s.id,
            name: s.name,
            script_type: s.script_type,
            script: s.script,
        })
        .collect();

    Json(TaggerScriptsResponse {
        scripts: scripts_data,
    })
    .into_response()
}

/// PUT /ferrotune/tagger/scripts
///
/// Save all scripts (replaces existing)
pub async fn save_scripts(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(scripts): Json<Vec<TaggerScriptData>>,
) -> impl IntoResponse {
    // Delete existing scripts
    if let Err(e) = sqlx::query("DELETE FROM tagger_scripts WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&state.pool)
        .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to clear scripts",
                e.to_string(),
            )),
        )
            .into_response();
    }

    // Insert new scripts
    let now = Utc::now().to_rfc3339();
    for (position, script) in scripts.iter().enumerate() {
        if let Err(e) = sqlx::query(
            r#"
            INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&script.id)
        .bind(user.user_id)
        .bind(&script.name)
        .bind(&script.script_type)
        .bind(&script.script)
        .bind(position as i64)
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details("Failed to save script", e.to_string())),
            )
                .into_response();
        }
    }

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /ferrotune/tagger/scripts/:id
///
/// Delete a specific script
pub async fn delete_script(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(script_id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = sqlx::query("DELETE FROM tagger_scripts WHERE id = ? AND user_id = ?")
        .bind(&script_id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to delete script",
                e.to_string(),
            )),
        )
            .into_response();
    }

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /ferrotune/tagger/session
///
/// Clear the entire session (tracks, edits, and reset to defaults)
pub async fn clear_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    // Delete tracks
    let _ = sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await;

    // Delete edits
    let _ = sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// POST /ferrotune/tagger/session/save
///
/// Save pending edits for tracks by reading from the database.
/// This is the primary way to persist tagger changes - it reads edited_tags,
/// computed_path, cover_art_removed, and cover_art_filename from the
/// tagger_pending_edits table and applies them to the audio files.
/// Also handles file renames using computed_path or path_overrides.
pub async fn save_pending_edits(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SavePendingEditsRequest>,
) -> impl IntoResponse {
    use crate::db::queries;

    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get session",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let cover_art_dir = get_cover_art_dir(&user.username);

    let mut saved_count = 0i32;
    let mut errors = Vec::<SaveError>::new();
    let mut rescan_recommended = false;
    let mut new_song_ids = Vec::<String>::new();
    let mut saved_library_song_ids = Vec::<String>::new(); // Track library songs to rescan

    // Tags that affect library organization
    let rescan_keys = [
        "ARTIST",
        "ALBUM",
        "ALBUMARTIST",
        "TITLE",
        "TRACKNUMBER",
        "DISCNUMBER",
        "YEAR",
        "GENRE",
    ];

    // Get music folders once for all tracks
    let music_folders = match queries::get_music_folders(&state.pool).await {
        Ok(folders) => folders,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to get music folders",
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    for track_id in &request.track_ids {
        // First, determine if this is a staged or library track
        let track_type: Option<(String,)> = match sqlx::query_as(
            "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
        )
        .bind(session_id)
        .bind(track_id)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(t) => t,
            Err(e) => {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: format!("Database error: {}", e),
                });
                continue;
            }
        };

        let track_type = match track_type {
            Some((t,)) => t,
            None => {
                // Track not in session, skip
                continue;
            }
        };

        let is_staged = track_type == "staged";
        // Get the pending edit from database
        let pending: Option<PendingEditRow> = match sqlx::query_as(
            r#"SELECT id, session_id, track_id, edited_tags, computed_path, 
                      cover_art_removed, cover_art_filename, created_at, updated_at
               FROM tagger_pending_edits 
               WHERE session_id = ? AND track_id = ?"#,
        )
        .bind(session_id)
        .bind(track_id)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(p) => p,
            Err(e) => {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: format!("Database error: {}", e),
                });
                continue;
            }
        };

        let pending = match pending {
            Some(p) => p,
            None => {
                // No pending edits for this track - skip
                continue;
            }
        };

        // Parse edited tags
        let edited_tags: HashMap<String, String> =
            serde_json::from_str(&pending.edited_tags).unwrap_or_default();

        // Check if this update requires rescan
        if edited_tags
            .keys()
            .any(|k| rescan_keys.contains(&k.to_uppercase().as_str()))
        {
            rescan_recommended = true;
        }

        if is_staged {
            // === STAGED FILE HANDLING ===

            // Check if we have a target music folder
            let target_folder = match request.target_music_folder_id {
                Some(id) => match music_folders.iter().find(|f| f.id == id) {
                    Some(f) => f,
                    None => {
                        errors.push(SaveError {
                            track_id: track_id.clone(),
                            error: "Target music folder not found".to_string(),
                        });
                        continue;
                    }
                },
                None => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: "Target music folder required for staged files".to_string(),
                    });
                    continue;
                }
            };

            // Get staged file info from database
            let staged_row: Option<(String, String)> = match sqlx::query_as(
                "SELECT staging_path, original_filename FROM tagger_staged_files WHERE id = ? AND user_id = ?",
            )
            .bind(track_id)
            .bind(&user.username)
            .fetch_optional(&state.pool)
            .await
            {
                Ok(r) => r,
                Err(e) => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: format!("Database error: {}", e),
                    });
                    continue;
                }
            };

            let (staging_path, original_filename) = match staged_row {
                Some(r) => r,
                None => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: "Staged file not found".to_string(),
                    });
                    continue;
                }
            };

            let staging_path = PathBuf::from(&staging_path);
            if !staging_path.exists() {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: "Staged file missing from disk".to_string(),
                });
                continue;
            }

            // Determine cover art action
            let cover_art_action = if pending.cover_art_removed {
                super::tags::CoverArtAction::Remove
            } else if let Some(ref filename) = pending.cover_art_filename {
                let cover_art_path = cover_art_dir.join(filename);
                match fs::read(&cover_art_path).await {
                    Ok(data) => {
                        let mime_type = match filename.rsplit('.').next() {
                            Some("jpg") | Some("jpeg") => "image/jpeg",
                            Some("png") => "image/png",
                            Some("gif") => "image/gif",
                            Some("webp") => "image/webp",
                            _ => "image/jpeg",
                        };
                        super::tags::CoverArtAction::Set(data, mime_type.to_string())
                    }
                    Err(e) => {
                        errors.push(SaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to read cover art: {}", e),
                        });
                        continue;
                    }
                }
            } else {
                super::tags::CoverArtAction::Keep
            };

            // Build update request for tags
            let update_request = super::tags::UpdateTagsRequest {
                set: edited_tags
                    .iter()
                    .map(|(k, v)| super::tags::TagEntry {
                        key: k.clone(),
                        value: v.clone(),
                    })
                    .collect(),
                delete: vec![],
            };

            // Apply tags and cover art to the staged file (in place)
            if let Err(e) = super::tags::update_tags_with_cover_art(
                &staging_path,
                &update_request,
                cover_art_action,
            )
            .await
            {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: e,
                });
                continue;
            }

            // Clean up cover art staging file
            if let Some(ref filename) = pending.cover_art_filename {
                let cover_art_path = cover_art_dir.join(filename);
                let _ = fs::remove_file(&cover_art_path).await;
            }

            // Determine target path - use computed_path, path_override, or original filename
            let target_rel_path = request
                .path_overrides
                .get(track_id)
                .cloned()
                .or(pending.computed_path.clone())
                .unwrap_or_else(|| original_filename.clone());

            let target_path = PathBuf::from(&target_folder.path).join(&target_rel_path);

            // Security check
            if !target_path.starts_with(&target_folder.path) {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: "Target path must be within music folder".to_string(),
                });
                continue;
            }

            // Create parent directories
            if let Some(parent) = target_path.parent() {
                if let Err(e) = fs::create_dir_all(parent).await {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: format!("Failed to create directories: {}", e),
                    });
                    continue;
                }
            }

            // Move file from staging to target
            if let Err(e) = fs::rename(&staging_path, &target_path).await {
                // Try copy + delete for cross-device moves
                match fs::copy(&staging_path, &target_path).await {
                    Ok(_) => {
                        let _ = fs::remove_file(&staging_path).await;
                    }
                    Err(copy_err) => {
                        errors.push(SaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to move file: {} (copy: {})", e, copy_err),
                        });
                        continue;
                    }
                }
            }

            // Delete from staged files table
            let _ = sqlx::query("DELETE FROM tagger_staged_files WHERE id = ? AND user_id = ?")
                .bind(track_id)
                .bind(&user.username)
                .execute(&state.pool)
                .await;

            // Remove from session tracks
            let _ = sqlx::query(
                "DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
            )
            .bind(session_id)
            .bind(track_id)
            .execute(&state.pool)
            .await;

            // Clear the pending edit
            let _ = sqlx::query(
                "DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
            )
            .bind(session_id)
            .bind(track_id)
            .execute(&state.pool)
            .await;

            // Add the relative path to new_song_ids for rescanning
            new_song_ids.push(target_rel_path);
            rescan_recommended = true;
            saved_count += 1;
        } else {
            // === LIBRARY FILE HANDLING ===

            // Get song info
            let song = match queries::get_song_by_id(&state.pool, track_id).await {
                Ok(Some(song)) => song,
                Ok(None) => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: "Song not found in library".to_string(),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: format!("Database error: {}", e),
                    });
                    continue;
                }
            };

            // Find the file path and which music folder it's in
            let mut full_path: Option<PathBuf> = None;
            let mut folder_path: Option<PathBuf> = None;
            for folder in &music_folders {
                let candidate = PathBuf::from(&folder.path).join(&song.file_path);
                if candidate.exists() {
                    full_path = Some(candidate);
                    folder_path = Some(PathBuf::from(&folder.path));
                    break;
                }
            }

            let (current_path, folder) = match (full_path, folder_path) {
                (Some(p), Some(f)) => (p, f),
                _ => {
                    errors.push(SaveError {
                        track_id: track_id.clone(),
                        error: "File not found on disk".to_string(),
                    });
                    continue;
                }
            };

            // Determine cover art action
            let cover_art_action = if pending.cover_art_removed {
                super::tags::CoverArtAction::Remove
            } else if let Some(ref filename) = pending.cover_art_filename {
                let cover_art_path = cover_art_dir.join(filename);
                match fs::read(&cover_art_path).await {
                    Ok(data) => {
                        let mime_type = match filename.rsplit('.').next() {
                            Some("jpg") | Some("jpeg") => "image/jpeg",
                            Some("png") => "image/png",
                            Some("gif") => "image/gif",
                            Some("webp") => "image/webp",
                            _ => "image/jpeg",
                        };
                        super::tags::CoverArtAction::Set(data, mime_type.to_string())
                    }
                    Err(e) => {
                        errors.push(SaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to read cover art: {}", e),
                        });
                        continue;
                    }
                }
            } else {
                super::tags::CoverArtAction::Keep
            };

            // Build update request for tags
            let update_request = super::tags::UpdateTagsRequest {
                set: edited_tags
                    .iter()
                    .map(|(k, v)| super::tags::TagEntry {
                        key: k.clone(),
                        value: v.clone(),
                    })
                    .collect(),
                delete: vec![],
            };

            // Apply tag changes with cover art support (on current path)
            if let Err(e) = super::tags::update_tags_with_cover_art(
                &current_path,
                &update_request,
                cover_art_action,
            )
            .await
            {
                errors.push(SaveError {
                    track_id: track_id.clone(),
                    error: e,
                });
                continue;
            }

            // Clean up cover art staging file
            if let Some(ref filename) = pending.cover_art_filename {
                let cover_art_path = cover_art_dir.join(filename);
                let _ = fs::remove_file(&cover_art_path).await;
            }

            // Handle file rename if there's a new path (from path_overrides or computed_path)
            let new_relative_path = request
                .path_overrides
                .get(track_id)
                .cloned()
                .or(pending.computed_path.clone());

            if let Some(ref new_rel_path) = new_relative_path {
                // Only rename if path actually changed
                if new_rel_path != &song.file_path {
                    rescan_recommended = true;

                    let new_path = folder.join(new_rel_path);

                    // Security check: ensure new path is still within the music folder
                    match new_path.canonicalize().or_else(|_| {
                        new_path
                            .parent()
                            .map(|p| p.join(new_path.file_name().unwrap_or_default()))
                            .ok_or(std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                "No parent",
                            ))
                    }) {
                        Ok(canonical) => {
                            if !canonical.starts_with(&folder) {
                                errors.push(SaveError {
                                    track_id: track_id.clone(),
                                    error: "New path must be within music folder".to_string(),
                                });
                                continue;
                            }
                        }
                        Err(_) => {
                            if !new_path
                                .to_string_lossy()
                                .starts_with(folder.to_string_lossy().as_ref())
                            {
                                errors.push(SaveError {
                                    track_id: track_id.clone(),
                                    error: "New path must be within music folder".to_string(),
                                });
                                continue;
                            }
                        }
                    }

                    // Create parent directories if needed
                    if let Some(parent) = new_path.parent() {
                        if let Err(e) = fs::create_dir_all(parent).await {
                            errors.push(SaveError {
                                track_id: track_id.clone(),
                                error: format!("Failed to create directory: {}", e),
                            });
                            continue;
                        }
                    }

                    // Move the file
                    if let Err(e) = fs::rename(&current_path, &new_path).await {
                        match fs::copy(&current_path, &new_path).await {
                            Ok(_) => {
                                if let Err(e) = fs::remove_file(&current_path).await {
                                    tracing::warn!("Failed to remove original: {}", e);
                                }
                            }
                            Err(copy_err) => {
                                errors.push(SaveError {
                                    track_id: track_id.clone(),
                                    error: format!("Failed to move: {} (copy: {})", e, copy_err),
                                });
                                continue;
                            }
                        }
                    }

                    // Update database path
                    if let Err(e) =
                        queries::update_song_path(&state.pool, track_id, new_rel_path).await
                    {
                        let _ = fs::rename(&new_path, &current_path).await;
                        errors.push(SaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to update database: {}", e),
                        });
                        continue;
                    }
                }
            }

            // Clear the pending edit for this track (it's now saved)
            let _ = sqlx::query(
                "DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
            )
            .bind(session_id)
            .bind(track_id)
            .execute(&state.pool)
            .await;

            saved_library_song_ids.push(track_id.clone());
            saved_count += 1;
        }
    }

    // Automatically rescan saved library tracks to update database
    // (cover art hashes, thumbnails, metadata)
    if !saved_library_song_ids.is_empty() {
        // Group files by folder for efficient scanning
        let mut files_by_folder: std::collections::HashMap<i64, Vec<std::path::PathBuf>> =
            std::collections::HashMap::new();

        for song_id in &saved_library_song_ids {
            if let Ok(Some(song)) = queries::get_song_by_id(&state.pool, song_id).await {
                // Find which folder contains this file
                for folder in &music_folders {
                    let candidate = std::path::PathBuf::from(&folder.path).join(&song.file_path);
                    if candidate.exists() {
                        files_by_folder
                            .entry(folder.id)
                            .or_default()
                            .push(candidate);
                        break;
                    }
                }
            }
        }

        // Scan files grouped by folder
        for (folder_id, file_paths) in files_by_folder {
            if let Err(e) =
                crate::scanner::scan_specific_files(&state.pool, folder_id, file_paths).await
            {
                tracing::warn!(
                    "Failed to rescan saved files for folder {}: {}",
                    folder_id,
                    e
                );
            }
        }
    }

    Json(SavePendingEditsResponse {
        success: errors.is_empty(),
        saved_count,
        errors,
        rescan_recommended,
        new_song_paths: new_song_ids,
    })
    .into_response()
}

/// Helper function to get track IDs for a user's session (for orphaned files detection)
pub async fn get_session_track_ids(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<Vec<String>, sqlx::Error> {
    // First get the session ID
    let session: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM tagger_sessions WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    let session_id = match session {
        Some((id,)) => id,
        None => return Ok(vec![]),
    };

    // Get all track IDs from the session (staged tracks only)
    let tracks: Vec<(String,)> = sqlx::query_as(
        "SELECT track_id FROM tagger_session_tracks WHERE session_id = ? AND track_type = 'staged'",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    Ok(tracks.into_iter().map(|(id,)| id).collect())
}
