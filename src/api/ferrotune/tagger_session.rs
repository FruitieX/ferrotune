//! Tagger Session API endpoints - Database-backed session storage
//!
//! This module provides endpoints for persisting tagger session state
//! in the database instead of preferences.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
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

use super::tagger::resolve_path_within_music_folder;
use super::ErrorResponse;

use crate::error::{Error, FerrotuneApiResult};

// =============================================================================
// Default Tagger Scripts (embedded at compile time)
// =============================================================================

/// Default rename script: AlbumArtist/Album/Artist - Title
pub const DEFAULT_SCRIPT_RENAME_ARTIST_TITLE: &str =
    include_str!("../../../scripts/tagger/rename_albumartist_album_artist_title.js");

/// Default rename script: AlbumArtist/Album/NN - Title (Picard-style)
pub const DEFAULT_SCRIPT_RENAME_TRACKNUM_TITLE: &str =
    include_str!("../../../scripts/tagger/rename_albumartist_album_tracknum_artist_title.js");

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
    /// Whether this edit has replacement audio staged
    pub has_replacement_audio: bool,
    /// The filename of the replacement audio (UUID-based, for internal use)
    pub replacement_audio_filename: Option<String>,
    /// The original filename of the replacement audio (for display)
    pub replacement_audio_original_name: Option<String>,
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
    replacement_audio_filename: Option<String>,
    replacement_audio_original_name: Option<String>,
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
    pub errors: Vec<SessionSaveError>,
    /// Whether a library rescan is recommended (if key tags changed)
    pub rescan_recommended: bool,
    /// New relative paths for staged files that were saved to library (for rescanning)
    pub new_song_paths: Vec<String>,
}

/// Progress event for streaming save endpoint
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveProgressEvent {
    /// Event type: 'progress' or 'complete'
    #[serde(rename = "type")]
    pub event_type: String,
    /// Current track index (0-based)
    pub current: i32,
    /// Total number of tracks
    pub total: i32,
    /// Track ID being processed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
    /// Error for current track (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Final response (only present on 'complete' event)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<SavePendingEditsResponse>,
}

/// Error for a single track save
/// Error for a single track save (in tagger session save operation)
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SessionSaveError {
    pub track_id: String,
    pub error: String,
}

// =============================================================================
// Database Helpers
// =============================================================================

// Re-export cross-filesystem utilities from common module
use crate::api::common::fs_utils::move_file_cross_fs;

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
) -> FerrotuneApiResult<Json<TaggerSessionResponse>> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Get session data
    let session: crate::db::models::TaggerSession = sqlx::query_as(
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
    .map_err(|e| Error::Internal(format!("Failed to fetch session: {}", e)))?
    .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    // Get tracks with types
    // Get tracks with types
    let track_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT track_id, track_type FROM tagger_session_tracks WHERE session_id = ? ORDER BY position",
    )
    .bind(session_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to fetch tracks: {}", e)))?;

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

    Ok(Json(TaggerSessionResponse {
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
    }))
}

/// PATCH /ferrotune/tagger/session
///
/// Update the current user's tagger session settings
pub async fn update_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdateTaggerSessionRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    let has_updates = request.visible_columns.is_some()
        || request.active_rename_script_id.is_some()
        || request.active_tag_script_id.is_some()
        || request.target_library_id.is_some()
        || request.show_library_prefix.is_some()
        || request.show_computed_path.is_some()
        || request.column_widths.is_some()
        || request.file_column_width.is_some()
        || request.details_panel_open.is_some()
        || request.dangerous_char_mode.is_some()
        || request.dangerous_char_replacement.is_some();

    if !has_updates {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Execute with a simpler approach - rebuild per field
    // Since sqlx doesn't support dynamic binding easily, we'll do individual updates
    if let Some(ref cols) = request.visible_columns {
        sqlx::query("UPDATE tagger_sessions SET visible_columns = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(serde_json::to_string(cols).unwrap_or_default())
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update visible columns: {}", e)))?;
    }
    if let Some(ref id) = request.active_rename_script_id {
        // Empty string means clear to NULL
        let value_to_bind: Option<&str> = if id.is_empty() { None } else { Some(id) };
        sqlx::query("UPDATE tagger_sessions SET active_rename_script_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(value_to_bind)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update active rename script: {}", e)))?;
    }
    if let Some(ref id) = request.active_tag_script_id {
        // Empty string means clear to NULL
        let value_to_bind: Option<&str> = if id.is_empty() { None } else { Some(id) };
        sqlx::query("UPDATE tagger_sessions SET active_tag_script_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(value_to_bind)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update active tag script: {}", e)))?;
    }
    if request.target_library_id.is_some() {
        sqlx::query("UPDATE tagger_sessions SET target_library_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&request.target_library_id)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update target library: {}", e)))?;
    }
    if let Some(show) = request.show_library_prefix {
        sqlx::query("UPDATE tagger_sessions SET show_library_prefix = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(show)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update show_library_prefix: {}", e)))?;
    }
    if let Some(show) = request.show_computed_path {
        sqlx::query("UPDATE tagger_sessions SET show_computed_path = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(show)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update show_computed_path: {}", e)))?;
    }
    if let Some(ref widths) = request.column_widths {
        sqlx::query("UPDATE tagger_sessions SET column_widths = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(serde_json::to_string(widths).unwrap_or_default())
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update column widths: {}", e)))?;
    }
    if let Some(width) = request.file_column_width {
        sqlx::query("UPDATE tagger_sessions SET file_column_width = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(width)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update file column width: {}", e)))?;
    }
    if let Some(open) = request.details_panel_open {
        sqlx::query("UPDATE tagger_sessions SET details_panel_open = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(open)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update details panel state: {}", e)))?;
    }
    if let Some(ref mode) = request.dangerous_char_mode {
        sqlx::query("UPDATE tagger_sessions SET dangerous_char_mode = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update dangerous char mode: {}", e)))?;
    }
    if let Some(ref replacement) = request.dangerous_char_replacement {
        sqlx::query("UPDATE tagger_sessions SET dangerous_char_replacement = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(replacement)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to update dangerous char replacement: {}", e)))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// PUT /ferrotune/tagger/session/tracks
///
/// Set the tracks in the current session (replaces existing)
pub async fn set_session_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetTaggerTracksRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Delete existing tracks
    if let Err(e) = sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await
    {
        return Err(Error::Internal(format!("Failed to clear tracks: {}", e)).into());
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
            return Err(Error::Internal(format!("Failed to add track: {}", e)).into());
        }
    }

    Ok(StatusCode::NO_CONTENT)
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
               cover_art_removed, cover_art_filename, replacement_audio_filename,
               replacement_audio_original_name, created_at, updated_at
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
        // has_replacement_audio is true if there's a replacement audio filename set
        let has_replacement_audio = edit.replacement_audio_filename.is_some();

        edits_map.insert(
            edit.track_id.clone(),
            TaggerPendingEditData {
                edited_tags,
                computed_path: edit.computed_path.clone(),
                cover_art_removed: edit.cover_art_removed,
                has_cover_art,
                has_replacement_audio,
                replacement_audio_filename: edit.replacement_audio_filename.clone(),
                replacement_audio_original_name: edit.replacement_audio_original_name.clone(),
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
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

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
        return Err(Error::Internal(format!("Failed to clear edits: {}", e)).into());
    }

    // Clean up cover art files
    let cover_art_dir = get_cover_art_dir(&user.username);
    for (filename,) in cover_art_filenames {
        if let Some(filename) = filename {
            let _ = fs::remove_file(cover_art_dir.join(&filename)).await;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

/// PUT /ferrotune/tagger/session/edits/:track_id
///
/// Update or create a pending edit for a single track (upsert)
pub async fn update_edit(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
    Json(request): Json<UpdatePendingEditRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    let edited_tags_json = serde_json::to_string(&request.edited_tags).unwrap_or_default();
    let now = Utc::now().to_rfc3339();

    // Look up the track_type from tagger_session_tracks
    let track_type: String = sqlx::query_scalar(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to lookup track type: {}", e)))?
    .unwrap_or_else(|| "library".to_string()); // Default to library if track not found

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
    .await {
        return Err(Error::Internal(format!("Failed to save edit: {}", e)).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /ferrotune/tagger/session/edits/:track_id
///
/// Delete a pending edit for a single track
pub async fn delete_edit(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    if let Err(e) =
        sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
            .bind(session_id)
            .bind(&track_id)
            .execute(&state.pool)
            .await
    {
        return Err(Error::Internal(format!("Failed to delete edit: {}", e)).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /ferrotune/tagger/session/tracks
///
/// Add tracks to the session (append)
pub async fn add_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<AddTracksRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

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
                return Err(
                    Error::Internal(format!("Failed to add track: {}", e)).into()
                );
            }
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /ferrotune/tagger/session/tracks/:track_id
///
/// Remove a single track from the session
pub async fn remove_track(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Delete the track
    if let Err(e) =
        sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
            .bind(session_id)
            .bind(&track_id)
            .execute(&state.pool)
            .await
    {
        return Err(Error::Internal(format!("Failed to remove track: {}", e)).into());
    }

    // Also delete any pending edit for this track
    if let Err(e) =
        sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
            .bind(session_id)
            .bind(&track_id)
            .execute(&state.pool)
            .await
    {
        tracing::warn!(
            "Failed to delete pending edit for track {}: {}",
            track_id,
            e
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /ferrotune/tagger/session/tracks/remove
///
/// Remove multiple tracks from the session (also cleans up cover art and staged files)
pub async fn remove_tracks(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RemoveTracksRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

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
                // The track_id IS the filename in format: {uuid}_{original_filename}
                let full_path = staging_dir.join(track_id);
                let _ = fs::remove_file(&full_path).await;
            }
        }

        // Delete the track from session
        if let Err(e) =
            sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(&state.pool)
                .await
        {
            tracing::warn!("Failed to delete session track {}: {}", track_id, e);
        }

        // Also delete any pending edit
        if let Err(e) =
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(&state.pool)
                .await
        {
            tracing::warn!(
                "Failed to delete pending edit during bulk remove for track {}: {}",
                track_id,
                e
            );
        }
    }

    Ok(StatusCode::NO_CONTENT)
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
) -> FerrotuneApiResult<Json<CoverArtUploadResponse>> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

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
                    return Err(Error::InvalidRequest(format!("Failed to read file: {}", e)).into());
                }
            }
        }
        Ok(None) => {
            return Err(Error::InvalidRequest("No file provided".to_string()).into());
        }
        Err(e) => {
            return Err(Error::InvalidRequest(format!("Failed to parse multipart: {}", e)).into());
        }
    };

    // Ensure cover art directory exists
    let cover_art_dir = get_cover_art_dir(&user.username);
    if let Err(e) = fs::create_dir_all(&cover_art_dir).await {
        return Err(Error::Internal(format!("Failed to create cover art directory: {}", e)).into());
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
                return Err(
                    Error::Internal(format!("Failed to write cover art file: {}", e)).into(),
                );
            }
        }
        Err(e) => {
            return Err(Error::Internal(format!("Failed to create cover art file: {}", e)).into());
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
        return Err(Error::Internal(format!("Failed to update cover art metadata: {}", e)).into());
    }

    Ok(Json(CoverArtUploadResponse { success: true }))
}

/// DELETE /ferrotune/tagger/session/edits/:track_id/cover
///
/// Remove cover art for a track (marks as removed and deletes file)
pub async fn delete_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Get and delete the cover art file
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

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
    .map_err(|e| Error::Internal(format!("Failed to lookup track type: {}", e)))?
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
        return Err(Error::Internal(format!("Failed to remove cover art: {}", e)).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/tagger/session/edits/:track_id/cover
///
/// Get cover art for a track (returns binary image from file)
pub async fn get_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Get cover art filename from database
    let result: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

    let filename = match result {
        Some((Some(f),)) => f,
        _ => return Err(Error::NotFound("Cover art not found".to_string()).into()),
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
        Ok(data) => Ok((
            [
                (axum::http::header::CONTENT_TYPE, mime_type.to_string()),
                (axum::http::header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            data,
        )
            .into_response()),
        Err(_) => Err(Error::NotFound("Cover art file missing".to_string()).into()),
    }
}

/// Get replacement audio staging directory for a user
fn get_replacement_audio_dir(username: &str) -> PathBuf {
    crate::config::get_data_dir()
        .join("staging")
        .join(username)
        .join("replacement_audio")
}

/// Request options for replacement audio upload
#[derive(Debug, Deserialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ReplacementAudioUploadOptions {
    /// Whether to replace the audio with the uploaded file (default: true)
    #[serde(default = "default_true")]
    pub import_audio: bool,
    /// Whether to import tags from the uploaded file
    #[serde(default)]
    pub import_tags: bool,
    /// Whether to import cover art from the uploaded file
    #[serde(default)]
    pub import_cover_art: bool,
}

fn default_true() -> bool {
    true
}

/// Response for replacement audio upload
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ReplacementAudioUploadResponse {
    /// Whether the upload was successful
    pub success: bool,
    /// File format (extension) of the uploaded file
    pub file_format: String,
    /// Original filename of the uploaded file (for display)
    pub original_name: String,
    /// Whether audio was imported (replaced)
    pub audio_imported: bool,
    /// Tags imported from the file (if import_tags was true)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_tags: Option<HashMap<String, String>>,
    /// Whether cover art was imported from the file
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_imported: Option<bool>,
}

/// PUT /ferrotune/tagger/session/edits/:track_id/replacement-audio
///
/// Upload replacement audio for a library track.
/// The replacement file will be staged and applied on save.
///
/// Multipart fields:
/// - file: The audio file to upload
/// - options: JSON object with import options (optional)
///   - importAudio: boolean (default: true) - Whether to replace the audio
///   - importTags: boolean (default: false) - Whether to import tags from the file
///   - importCoverArt: boolean (default: false) - Whether to import cover art from the file
pub async fn upload_replacement_audio(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
    mut multipart: axum::extract::Multipart,
) -> FerrotuneApiResult<Json<ReplacementAudioUploadResponse>> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Check that this is a library track (not staged)
    let track_type: Option<(String,)> = sqlx::query_as(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to lookup track type: {}", e)))?;

    match track_type {
        Some((t,)) if t == "staged" => {
            return Err(
                Error::InvalidRequest("Cannot replace audio for staged files".to_string()).into(),
            );
        }
        None => {
            return Err(Error::NotFound("Track not found in session".to_string()).into());
        }
        _ => {} // library track, proceed
    }

    // Extract file and options from multipart
    let mut file_data: Option<(Vec<u8>, String)> = None;
    let mut options = ReplacementAudioUploadOptions {
        import_audio: true,
        import_tags: false,
        import_cover_art: false,
    };

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().map(|s| s.to_string()).unwrap_or_default();

        if name == "file" {
            let filename = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "audio.mp3".to_string());

            match field.bytes().await {
                Ok(bytes) => {
                    file_data = Some((bytes.to_vec(), filename));
                }
                Err(e) => {
                    return Err(Error::InvalidRequest(format!("Failed to read file: {}", e)).into());
                }
            }
        } else if name == "options" {
            match field.bytes().await {
                Ok(bytes) => {
                    if let Ok(parsed) =
                        serde_json::from_slice::<ReplacementAudioUploadOptions>(&bytes)
                    {
                        options = parsed;
                    }
                }
                Err(_) => {
                    // Ignore options parsing errors, use defaults
                }
            }
        }
    }

    let (data, original_filename) = match file_data {
        Some(d) => d,
        None => {
            return Err(Error::InvalidRequest("No file provided".to_string()).into());
        }
    };

    // Validate file extension
    let ext = original_filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let valid_extensions = ["mp3", "flac", "ogg", "m4a", "opus", "wav", "aac", "wma"];
    if !valid_extensions.contains(&ext.as_str()) {
        return Err(Error::InvalidRequest(format!("Extension '{}' is not supported", ext)).into());
    }

    // At least one import option must be enabled
    if !options.import_audio && !options.import_tags && !options.import_cover_art {
        return Err(Error::InvalidRequest(
            "At least one import option must be enabled".to_string(),
        )
        .into());
    }

    // Write to a temporary file so we can parse it with lofty
    let temp_dir = std::env::temp_dir();
    let temp_filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let temp_path = temp_dir.join(&temp_filename);

    if let Err(e) = fs::write(&temp_path, &data).await {
        return Err(Error::Internal(format!("Failed to write temporary file: {}", e)).into());
    }

    // Extract tags and cover art from the file if needed
    let mut imported_tags: Option<HashMap<String, String>> = None;
    let mut cover_art_data: Option<Vec<u8>> = None;

    if options.import_tags || options.import_cover_art {
        let temp_path_clone = temp_path.clone();
        let import_tags = options.import_tags;
        let import_cover_art = options.import_cover_art;

        let extraction_result = tokio::task::spawn_blocking(move || {
            use lofty::config::ParseOptions;
            use lofty::file::TaggedFileExt;
            use lofty::probe::Probe;
            use lofty::tag::Accessor;

            let parse_options = ParseOptions::new().read_properties(false);

            let tagged_file =
                match Probe::open(&temp_path_clone).and_then(|p| p.options(parse_options).read()) {
                    Ok(f) => f,
                    Err(e) => return Err(format!("Failed to read file tags: {}", e)),
                };

            let mut tags: Option<HashMap<String, String>> = None;
            let mut cover: Option<Vec<u8>> = None;

            if import_tags {
                let mut tag_map = HashMap::new();
                if let Some(tag) = tagged_file.primary_tag() {
                    // Extract common tags using standard uppercase key names
                    if let Some(v) = tag.title() {
                        tag_map.insert("TITLE".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.artist() {
                        tag_map.insert("ARTIST".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.album() {
                        tag_map.insert("ALBUM".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.genre() {
                        tag_map.insert("GENRE".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.year() {
                        tag_map.insert("YEAR".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.track() {
                        tag_map.insert("TRACKNUMBER".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.disk() {
                        tag_map.insert("DISCNUMBER".to_string(), v.to_string());
                    }
                    if let Some(v) = tag.comment() {
                        tag_map.insert("COMMENT".to_string(), v.to_string());
                    }

                    // Also check for album artist
                    if let Some(v) = tag.get_string(&lofty::tag::ItemKey::AlbumArtist) {
                        tag_map.insert("ALBUMARTIST".to_string(), v.to_string());
                    }
                }

                // Always return the tag map when importing tags, even if empty
                // This clears existing tags if the source file has none
                tags = Some(tag_map);
            }

            if import_cover_art {
                // Try to get cover art from any tag
                let picture = tagged_file
                    .primary_tag()
                    .and_then(|tag| tag.pictures().first())
                    .or_else(|| {
                        tagged_file
                            .tags()
                            .iter()
                            .find_map(|tag| tag.pictures().first())
                    });

                if let Some(pic) = picture {
                    cover = Some(pic.data().to_vec());
                }
            }

            Ok((tags, cover))
        })
        .await;

        match extraction_result {
            Ok(Ok((tags, cover))) => {
                imported_tags = tags;
                cover_art_data = cover;
            }
            Ok(Err(e)) => {
                let _ = fs::remove_file(&temp_path).await;
                return Err(
                    Error::InvalidRequest(format!("Failed to extract metadata: {}", e)).into(),
                );
            }
            Err(e) => {
                let _ = fs::remove_file(&temp_path).await;
                return Err(Error::Internal(format!("Failed to process file: {}", e)).into());
            }
        }
    }

    // Clean up temp file
    let _ = fs::remove_file(&temp_path).await;

    let mut replacement_audio_filename: Option<String> = None;
    let mut cover_art_filename: Option<String> = None;

    // Handle audio import
    if options.import_audio {
        let replacement_dir = get_replacement_audio_dir(&user.username);
        if let Err(e) = fs::create_dir_all(&replacement_dir).await {
            return Err(Error::Internal(format!(
                "Failed to create replacement audio directory: {}",
                e
            ))
            .into());
        }

        // Get existing replacement audio filename to clean up
        let existing_filename: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT replacement_audio_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
        )
        .bind(session_id)
        .bind(&track_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

        // Delete old replacement audio file if exists
        if let Some((Some(old_filename),)) = existing_filename {
            let old_path = replacement_dir.join(&old_filename);
            let _ = fs::remove_file(&old_path).await;
        }

        // Generate UUID filename with extension
        let uuid = uuid::Uuid::new_v4();
        let filename = format!("{}.{}", uuid, ext);
        let replacement_path = replacement_dir.join(&filename);

        // Write the new replacement audio file
        if let Err(e) = fs::write(&replacement_path, &data).await {
            return Err(
                Error::Internal(format!("Failed to write replacement audio file: {}", e)).into(),
            );
        }

        replacement_audio_filename = Some(filename);
    }

    // Handle cover art import
    // cover_art_imported: Some(true) = new cover art uploaded, Some(false) = cover art removed, None = no change
    let (cover_art_imported, should_remove_cover_art) = if options.import_cover_art {
        if let Some(cover_data) = cover_art_data {
            let cover_art_dir = get_cover_art_dir(&user.username);
            if let Err(e) = fs::create_dir_all(&cover_art_dir).await {
                return Err(Error::Internal(format!(
                    "Failed to create cover art directory: {}",
                    e
                ))
                .into());
            }

            // Get existing cover art filename to clean up
            let existing_cover: Option<(Option<String>,)> = sqlx::query_as(
                "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
            )
            .bind(session_id)
            .bind(&track_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

            // Delete old cover art file if exists
            if let Some((Some(old_filename),)) = existing_cover {
                let old_path = cover_art_dir.join(&old_filename);
                let _ = fs::remove_file(&old_path).await;
            }

            // Detect image type and extension
            let img_ext = if cover_data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                ".png"
            } else if cover_data.starts_with(&[0x47, 0x49, 0x46]) {
                ".gif"
            } else if cover_data.starts_with(b"RIFF")
                && cover_data.len() > 12
                && &cover_data[8..12] == b"WEBP"
            {
                ".webp"
            } else {
                ".jpg"
            };

            let uuid = uuid::Uuid::new_v4();
            let filename = format!("{}{}", uuid, img_ext);
            let cover_path = cover_art_dir.join(&filename);

            if let Err(e) = fs::write(&cover_path, &cover_data).await {
                return Err(
                    Error::Internal(format!("Failed to write cover art file: {}", e)).into(),
                );
            }

            cover_art_filename = Some(filename);
            (Some(true), false) // Cover art was added
        } else {
            // Source file has no cover art - mark as removed to clear existing
            (Some(false), true)
        }
    } else {
        (None, false)
    };

    // Update the database
    let now = Utc::now().to_rfc3339();

    // Get existing pending edit to merge with
    let existing_edit: Option<(String, Option<String>, i32, Option<String>)> = sqlx::query_as(
        "SELECT edited_tags, cover_art_filename, cover_art_removed, replacement_audio_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

    // Replace edited tags if importing tags (no merging - clear all existing and replace with imported)
    let final_edited_tags = if let Some(ref new_tags) = imported_tags {
        // Don't merge - just use the imported tags directly, clearing any previously edited tags
        serde_json::to_string(new_tags).unwrap_or_else(|_| "{}".to_string())
    } else if let Some((ref existing_tags_json, _, _, _)) = existing_edit {
        existing_tags_json.clone()
    } else {
        "{}".to_string()
    };

    // Determine final cover art filename
    // If should_remove_cover_art is true, we clear the filename and set removed flag
    let final_cover_art_filename = if should_remove_cover_art {
        None // Clear any staged cover art since we're removing it
    } else if cover_art_filename.is_some() {
        cover_art_filename
    } else if let Some((_, ref existing_cover, _, _)) = existing_edit {
        existing_cover.clone()
    } else {
        None
    };

    // Determine cover_art_removed
    // Set to 1 if we're marking cover art as removed (source file had no cover art)
    // Reset to 0 if we're adding new cover art
    let cover_art_removed = if should_remove_cover_art {
        1 // Mark as removed
    } else if final_cover_art_filename.is_some() {
        0 // Adding new cover art, so not removed
    } else if let Some((_, _, existing_removed, _)) = existing_edit {
        existing_removed
    } else {
        0
    };

    // Determine final replacement audio
    let (final_replacement_filename, final_replacement_original_name) = if options.import_audio {
        (replacement_audio_filename, Some(original_filename.clone()))
    } else if let Some((_, _, _, ref existing_replacement)) = existing_edit {
        (existing_replacement.clone(), None) // Keep existing
    } else {
        (None, None)
    };

    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO tagger_pending_edits 
        (session_id, track_id, track_type, edited_tags, cover_art_filename, cover_art_removed, replacement_audio_filename, replacement_audio_original_name, created_at, updated_at)
        VALUES (?, ?, 'library', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, track_id) DO UPDATE SET
            edited_tags = excluded.edited_tags,
            cover_art_filename = excluded.cover_art_filename,
            cover_art_removed = excluded.cover_art_removed,
            replacement_audio_filename = COALESCE(excluded.replacement_audio_filename, tagger_pending_edits.replacement_audio_filename),
            replacement_audio_original_name = COALESCE(excluded.replacement_audio_original_name, tagger_pending_edits.replacement_audio_original_name),
            updated_at = excluded.updated_at
        "#,
    )
    .bind(session_id)
    .bind(&track_id)
    .bind(&final_edited_tags)
    .bind(&final_cover_art_filename)
    .bind(cover_art_removed)
    .bind(&final_replacement_filename)
    .bind(&final_replacement_original_name)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    {
        return Err(Error::Internal(format!("Failed to update pending edits: {}", e)).into());
    }

    Ok(Json(ReplacementAudioUploadResponse {
        success: true,
        file_format: ext,
        original_name: original_filename,
        audio_imported: options.import_audio,
        imported_tags,
        cover_art_imported,
    }))
}

/// DELETE /ferrotune/tagger/session/edits/:track_id/replacement-audio
///
/// Remove staged replacement audio for a track
pub async fn delete_replacement_audio(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Get and delete the replacement audio file
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT replacement_audio_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| Error::Internal(format!("Failed to fetch pending edit: {}", e)))?;

    if let Some((Some(filename),)) = existing {
        let replacement_dir = get_replacement_audio_dir(&user.username);
        let _ = fs::remove_file(replacement_dir.join(&filename)).await;
    }

    // Clear the replacement_audio_filename in database
    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "UPDATE tagger_pending_edits SET replacement_audio_filename = NULL, updated_at = ? WHERE session_id = ? AND track_id = ?",
    )
    .bind(&now)
    .bind(session_id)
    .bind(&track_id)
    .execute(&state.pool)
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/tagger/session/edits/:track_id/replacement-audio/stream
///
/// Stream the replacement audio file for preview playback.
pub async fn stream_replacement_audio(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<String>,
    headers: HeaderMap,
) -> FerrotuneApiResult<axum::response::Response> {
    use axum::http::header;
    use tokio::io::AsyncReadExt;

    // Get user's session
    let session_id: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM tagger_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let session_id = match session_id {
        Some((id,)) => id,
        None => {
            return Err(Error::NotFound("Tagger session not found".to_string()).into());
        }
    };

    // Get replacement audio filename from database
    let filename: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT replacement_audio_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(&track_id)
    .fetch_optional(&state.pool)
    .await?;

    let filename = match filename {
        Some((Some(f),)) => f,
        _ => {
            return Err(Error::NotFound("No replacement audio found".to_string()).into());
        }
    };

    let replacement_dir = get_replacement_audio_dir(&user.username);
    let file_path = replacement_dir.join(&filename);

    if !file_path.exists() {
        return Err(Error::NotFound(
            "The replacement audio file does not exist on disk".to_string(),
        )
        .into());
    }

    // Get file metadata
    let metadata = fs::metadata(&file_path)
        .await
        .map_err(|e| Error::Internal(format!("Failed to read file metadata: {}", e)))?;

    let file_size = metadata.len();

    // Determine content type from extension
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let content_type = crate::api::common::utils::get_content_type_for_format(&ext);

    // Parse Range header for seeking support
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            if let Some(range_str) = s.strip_prefix("bytes=") {
                let parts: Vec<&str> = range_str.split('-').collect();
                if parts.len() == 2 {
                    let start = parts[0].parse::<u64>().ok()?;
                    let end = if parts[1].is_empty() {
                        file_size - 1
                    } else {
                        parts[1].parse::<u64>().ok()?
                    };
                    Some((start, end))
                } else {
                    None
                }
            } else {
                None
            }
        });

    // Read file content
    let mut file = fs::File::open(&file_path)
        .await
        .map_err(|e| Error::Internal(format!("Failed to open file: {}", e)))?;

    match range {
        Some((start, end)) => {
            // Partial content response
            use tokio::io::AsyncSeekExt;

            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|e| Error::Internal(format!("Failed to seek in file: {}", e)))?;

            let content_length = end - start + 1;
            let mut buffer = vec![0u8; content_length as usize];
            file.read_exact(&mut buffer)
                .await
                .map_err(|e| Error::Internal(format!("Failed to read file: {}", e)))?;

            Ok((
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (header::CONTENT_LENGTH, content_length.to_string()),
                    (
                        header::CONTENT_RANGE,
                        format!("bytes {}-{}/{}", start, end, file_size),
                    ),
                    (header::CACHE_CONTROL, "no-cache".to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                ],
                buffer,
            )
                .into_response())
        }
        None => {
            // Full content response
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .await
                .map_err(|e| Error::Internal(format!("Failed to read file: {}", e)))?;

            Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (header::CONTENT_LENGTH, file_size.to_string()),
                    (header::CACHE_CONTROL, "no-cache".to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                ],
                buffer,
            )
                .into_response())
        }
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
) -> FerrotuneApiResult<StatusCode> {
    // Delete existing scripts
    sqlx::query("DELETE FROM tagger_scripts WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to clear scripts: {}", e)))?;

    // Insert new scripts
    let now = Utc::now().to_rfc3339();
    for (position, script) in scripts.iter().enumerate() {
        sqlx::query(
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
        .map_err(|e| Error::Internal(format!("Failed to save script: {}", e)))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /ferrotune/tagger/scripts/:id
///
/// Delete a specific script
pub async fn delete_script(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(script_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    sqlx::query("DELETE FROM tagger_scripts WHERE id = ? AND user_id = ?")
        .bind(&script_id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to delete script: {}", e)))?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /ferrotune/tagger/session
///
/// Clear the entire session (tracks, edits, and reset to defaults)
pub async fn clear_session(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<StatusCode> {
    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    // Delete tracks
    sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to delete tracks: {}", e)))?;

    // Delete edits
    sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ?")
        .bind(session_id)
        .execute(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to delete edits: {}", e)))?;

    Ok(StatusCode::NO_CONTENT)
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
) -> FerrotuneApiResult<axum::response::Response> {
    use crate::db::queries;

    let session_id = get_or_create_session(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get session: {}", e)))?;

    let cover_art_dir = get_cover_art_dir(&user.username);
    let staging_dir = super::tagger::get_staging_dir(&state, &user.username);

    let mut saved_count = 0i32;
    let mut errors = Vec::<SessionSaveError>::new();
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
    let music_folders = queries::get_music_folders(&state.pool)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get music folders: {}", e)))?;

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
                errors.push(SessionSaveError {
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
                      cover_art_removed, cover_art_filename, replacement_audio_filename,
                      replacement_audio_original_name, created_at, updated_at
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
                errors.push(SessionSaveError {
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
                        errors.push(SessionSaveError {
                            track_id: track_id.clone(),
                            error: "Target music folder not found".to_string(),
                        });
                        continue;
                    }
                },
                None => {
                    errors.push(SessionSaveError {
                        track_id: track_id.clone(),
                        error: "Target music folder required for staged files".to_string(),
                    });
                    continue;
                }
            };

            // Get staged file info - the track_id IS the filename in format: {uuid}_{original_filename}
            // Extract original_filename by stripping the UUID prefix (36 chars + underscore)
            let original_filename = if track_id.len() > 37 && track_id.chars().nth(36) == Some('_')
            {
                track_id[37..].to_string()
            } else {
                track_id.clone()
            };

            let staging_path = staging_dir.join(track_id);
            if !staging_path.exists() {
                errors.push(SessionSaveError {
                    track_id: track_id.clone(),
                    error: "Staged file not found".to_string(),
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
                        errors.push(SessionSaveError {
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
                errors.push(SessionSaveError {
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

            let target_path = match resolve_path_within_music_folder(
                std::path::Path::new(&target_folder.path),
                &target_rel_path,
            )
            .await
            {
                Ok(path) => path,
                Err(e) => {
                    errors.push(SessionSaveError {
                        track_id: track_id.clone(),
                        error: e,
                    });
                    continue;
                }
            };

            // Move file from staging to target (with cross-filesystem support)
            if let Err(e) = move_file_cross_fs(&staging_path, &target_path).await {
                errors.push(SessionSaveError {
                    track_id: track_id.clone(),
                    error: format!("Failed to move file: {}", e),
                });
                continue;
            }

            // Remove from session tracks (file is moved, no separate cleanup needed)
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
                    errors.push(SessionSaveError {
                        track_id: track_id.clone(),
                        error: "Song not found in library".to_string(),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(SessionSaveError {
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
                    errors.push(SessionSaveError {
                        track_id: track_id.clone(),
                        error: "File not found on disk".to_string(),
                    });
                    continue;
                }
            };

            // Track the actual path we'll be working with (may change if replacement audio)
            let mut working_path = current_path.clone();

            // Track if we need to copy original tags/cover to replacement audio
            let mut original_tags_for_replacement: Option<Vec<super::tags::TagEntry>> = None;
            let mut original_cover_for_replacement: Option<(Vec<u8>, String)> = None;

            // Track if audio was replaced with a different format (e.g. .opus -> .mp3)
            let mut replaced_ext: Option<String> = None;

            // Handle replacement audio if present
            if let Some(ref replacement_filename) = pending.replacement_audio_filename {
                let replacement_dir = get_replacement_audio_dir(&user.username);
                let replacement_file_path = replacement_dir.join(replacement_filename);

                if replacement_file_path.exists() {
                    // BEFORE replacing, read tags and cover art from the ORIGINAL file
                    // so we can apply them to the replacement
                    let original_path_clone = current_path.clone();
                    let original_data = tokio::task::spawn_blocking(move || {
                        use lofty::prelude::*;
                        use lofty::probe::Probe;

                        let tagged_file = match Probe::open(&original_path_clone)
                            .and_then(|probe| probe.read())
                        {
                            Ok(f) => f,
                            Err(e) => {
                                tracing::warn!("Failed to read original file tags: {}", e);
                                return (Vec::new(), None);
                            }
                        };

                        // Extract tags from primary tag
                        let tags = if let Some(tag) = tagged_file.primary_tag() {
                            super::tags::extract_tags_from_tag(tag)
                        } else {
                            Vec::new()
                        };

                        // Extract cover art
                        let cover = tagged_file
                            .primary_tag()
                            .and_then(|tag| tag.pictures().first())
                            .or_else(|| {
                                tagged_file
                                    .tags()
                                    .iter()
                                    .find_map(|tag| tag.pictures().first())
                            })
                            .map(|pic| {
                                let mime = pic
                                    .mime_type()
                                    .map_or_else(|| "image/jpeg".to_string(), |m| m.to_string());
                                (pic.data().to_vec(), mime)
                            });

                        (tags, cover)
                    })
                    .await
                    .unwrap_or_else(|e| {
                        tracing::warn!("Failed to spawn blocking task: {}", e);
                        (Vec::new(), None)
                    });

                    original_tags_for_replacement = Some(original_data.0);
                    original_cover_for_replacement = original_data.1;

                    // Get the new extension from the replacement file
                    let new_ext = replacement_filename
                        .rsplit('.')
                        .next()
                        .unwrap_or("")
                        .to_lowercase();
                    let old_ext = current_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();

                    // Determine target path - same as original but with new extension if different
                    let target_path = if new_ext != old_ext {
                        current_path.with_extension(&new_ext)
                    } else {
                        current_path.clone()
                    };

                    // Use a safe copy strategy: copy to temp file first, then rename
                    // This prevents data loss if the copy fails partway through
                    // Temp file is in the same directory as target so rename is atomic
                    let temp_path = target_path.with_extension(format!("{}.tmp", new_ext));

                    tracing::debug!(
                        "Replacing audio: src={} temp={} target={}",
                        replacement_file_path.display(),
                        temp_path.display(),
                        target_path.display()
                    );

                    // Step 1: Read source file and write to temp file
                    // Using read+write instead of fs::copy for better cross-filesystem compatibility
                    let copy_result: Result<(), std::io::Error> = async {
                        let data = fs::read(&replacement_file_path).await?;
                        fs::write(&temp_path, &data).await?;
                        Ok(())
                    }
                    .await;

                    match copy_result {
                        Ok(_) => {
                            // Step 2: Rename temp file to target (atomic on same filesystem)
                            match fs::rename(&temp_path, &target_path).await {
                                Ok(_) => {
                                    // Step 3: Delete the old file if extension changed
                                    if new_ext != old_ext && current_path.exists() {
                                        if let Err(e) = fs::remove_file(&current_path).await {
                                            tracing::warn!(
                                                "Failed to remove old file after replacement: {}",
                                                e
                                            );
                                        }
                                    }

                                    // Update working path
                                    working_path = target_path.clone();

                                    // Track the new extension for the rename block
                                    if new_ext != old_ext {
                                        replaced_ext = Some(new_ext.clone());
                                    }

                                    // Update database path if extension changed
                                    if new_ext != old_ext {
                                        let old_rel_path = &song.file_path;
                                        // Find the position of the last dot and extract the stem
                                        let new_rel_path =
                                            if let Some(pos) = old_rel_path.rfind('.') {
                                                format!("{}.{}", &old_rel_path[..pos], new_ext)
                                            } else {
                                                format!("{}.{}", old_rel_path, new_ext)
                                            };

                                        if let Err(e) = queries::update_song_path_and_format(
                                            &state.pool,
                                            track_id,
                                            &new_rel_path,
                                            &new_ext,
                                        )
                                        .await
                                        {
                                            tracing::warn!(
                                                "Failed to update song path in database: {}",
                                                e
                                            );
                                        }
                                    }

                                    // Clean up the staged replacement file
                                    let _ = fs::remove_file(&replacement_file_path).await;
                                }
                                Err(e) => {
                                    // Clean up temp file on rename failure
                                    let _ = fs::remove_file(&temp_path).await;
                                    tracing::error!(
                                        "Failed to rename {} -> {}: {}",
                                        temp_path.display(),
                                        target_path.display(),
                                        e
                                    );
                                    errors.push(SessionSaveError {
                                        track_id: track_id.clone(),
                                        error: format!(
                                            "Failed to rename replacement audio to {}: {}",
                                            target_path.display(),
                                            e
                                        ),
                                    });
                                    continue;
                                }
                            }
                        }
                        Err(e) => {
                            // Clean up temp file if it was partially written
                            let _ = fs::remove_file(&temp_path).await;
                            tracing::error!(
                                "Failed to copy {} -> {}: {}",
                                replacement_file_path.display(),
                                temp_path.display(),
                                e
                            );
                            errors.push(SessionSaveError {
                                track_id: track_id.clone(),
                                error: format!(
                                    "Failed to copy replacement audio from {} to {}: {}",
                                    replacement_file_path.display(),
                                    temp_path.display(),
                                    e
                                ),
                            });
                            continue;
                        }
                    }

                    rescan_recommended = true;
                } else {
                    tracing::warn!(
                        "Replacement audio file not found: {}",
                        replacement_file_path.display()
                    );
                }
            }

            // Determine cover art action
            // For replacement audio: use original cover unless user explicitly changed/removed it
            let cover_art_action = if pending.cover_art_removed {
                super::tags::CoverArtAction::Remove
            } else if let Some(ref filename) = pending.cover_art_filename {
                // User explicitly set new cover art
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
                        errors.push(SessionSaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to read cover art: {}", e),
                        });
                        continue;
                    }
                }
            } else if let Some((cover_data, mime)) = original_cover_for_replacement {
                // Replacement audio: copy cover art from original file
                super::tags::CoverArtAction::Set(cover_data, mime)
            } else {
                super::tags::CoverArtAction::Keep
            };

            // Build update request for tags
            // For replacement audio: start with original tags, then overlay user edits
            let tags_to_set = if let Some(original_tags) = original_tags_for_replacement {
                // Start with original tags
                let mut tag_map: std::collections::HashMap<String, String> = original_tags
                    .into_iter()
                    .map(|t| (t.key, t.value))
                    .collect();
                // Apply user edits on top
                for (key, value) in &edited_tags {
                    tag_map.insert(key.clone(), value.clone());
                }
                tag_map
                    .into_iter()
                    .map(|(key, value)| super::tags::TagEntry { key, value })
                    .collect()
            } else {
                // No replacement - just apply user edits
                edited_tags
                    .iter()
                    .map(|(k, v)| super::tags::TagEntry {
                        key: k.clone(),
                        value: v.clone(),
                    })
                    .collect()
            };

            let update_request = super::tags::UpdateTagsRequest {
                set: tags_to_set,
                delete: vec![],
            };

            // Apply tag changes with cover art support (on working path - could be replacement file)
            if let Err(e) = super::tags::update_tags_with_cover_art(
                &working_path,
                &update_request,
                cover_art_action,
            )
            .await
            {
                errors.push(SessionSaveError {
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

            if let Some(new_rel_path) = new_relative_path {
                // If audio was replaced with a different format, update the extension
                // in the rename path (computed_path was calculated before replacement)
                let new_rel_path = if let Some(ref ext) = replaced_ext {
                    if let Some(pos) = new_rel_path.rfind('.') {
                        format!("{}.{}", &new_rel_path[..pos], ext)
                    } else {
                        new_rel_path
                    }
                } else {
                    new_rel_path
                };

                // Compare against the current DB path (which may have been updated
                // by audio replacement) rather than the stale song.file_path
                let current_rel_path = working_path
                    .strip_prefix(&folder)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| song.file_path.clone());

                // Only rename if path actually changed
                if new_rel_path != current_rel_path {
                    rescan_recommended = true;

                    let new_path = folder.join(&new_rel_path);

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
                                errors.push(SessionSaveError {
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
                                errors.push(SessionSaveError {
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
                            errors.push(SessionSaveError {
                                track_id: track_id.clone(),
                                error: format!("Failed to create directory: {}", e),
                            });
                            continue;
                        }
                    }

                    // Move the file (use working_path which reflects the actual
                    // file location after audio replacement)
                    if let Err(e) = move_file_cross_fs(&working_path, &new_path).await {
                        errors.push(SessionSaveError {
                            track_id: track_id.clone(),
                            error: format!("Failed to move file: {}", e),
                        });
                        continue;
                    }

                    // Update database path (and format if audio was replaced)
                    let db_result = if replaced_ext.is_some() {
                        let ext = working_path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        queries::update_song_path_and_format(
                            &state.pool,
                            track_id,
                            &new_rel_path,
                            &ext,
                        )
                        .await
                    } else {
                        queries::update_song_path(&state.pool, track_id, &new_rel_path).await
                    };

                    if let Err(e) = db_result {
                        // Try to move back on failure
                        let _ = move_file_cross_fs(&new_path, &working_path).await;
                        errors.push(SessionSaveError {
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

    // Log errors if any occurred
    if !errors.is_empty() {
        tracing::warn!(
            "Save completed with {} errors out of {} tracks",
            errors.len(),
            saved_count as usize + errors.len()
        );
        for error in &errors {
            tracing::warn!("  - {}: {}", error.track_id, error.error);
        }
    }

    // Return appropriate status code based on results
    // Return appropriate status code based on results
    let status = if errors.is_empty() {
        StatusCode::OK
    } else if saved_count == 0 {
        StatusCode::INTERNAL_SERVER_ERROR
    } else {
        // Partial success
        StatusCode::MULTI_STATUS
    };

    Ok((
        status,
        Json(SavePendingEditsResponse {
            success: errors.is_empty(),
            saved_count,
            errors,
            rescan_recommended,
            new_song_paths: new_song_ids,
        }),
    )
        .into_response())
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

/// POST /ferrotune/tagger/session/save-stream
///
/// Stream save progress for pending edits using Server-Sent Events.
/// Each track is saved and progress is streamed back to the client.
/// This allows the server to parallelize saves in the future while
/// providing real-time progress feedback.
pub async fn save_pending_edits_stream(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SavePendingEditsRequest>,
) -> impl IntoResponse {
    use axum::response::sse::{Event, Sse};
    use std::convert::Infallible;
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<SaveProgressEvent>(16);

    // Spawn the save work in a background task so events stream as they're produced
    tokio::spawn(async move {
        save_pending_edits_internal(user, state, request, tx).await;
    });

    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok::<_, Infallible>(Event::default().data(data))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    )
}

/// Internal implementation that sends progress events via channel
async fn save_pending_edits_internal(
    user: FerrotuneAuthenticatedUser,
    state: Arc<AppState>,
    request: SavePendingEditsRequest,
    tx: tokio::sync::mpsc::Sender<SaveProgressEvent>,
) {
    use crate::db::queries;

    let total = request.track_ids.len() as i32;

    let session_id = match get_or_create_session(&state.pool, user.user_id).await {
        Ok(id) => id,
        Err(e) => {
            let _ = tx
                .send(SaveProgressEvent {
                    event_type: "complete".to_string(),
                    current: 0,
                    total,
                    track_id: None,
                    error: Some(format!("Failed to get session: {}", e)),
                    result: Some(SavePendingEditsResponse {
                        success: false,
                        saved_count: 0,
                        errors: vec![],
                        rescan_recommended: false,
                        new_song_paths: vec![],
                    }),
                })
                .await;
            return;
        }
    };

    let cover_art_dir = get_cover_art_dir(&user.username);
    let staging_dir = super::tagger::get_staging_dir(&state, &user.username);

    let mut saved_count = 0i32;
    let mut errors = Vec::<SessionSaveError>::new();
    let mut rescan_recommended = false;
    let mut new_song_ids = Vec::<String>::new();
    let mut saved_library_song_ids = Vec::<String>::new();

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
            let _ = tx
                .send(SaveProgressEvent {
                    event_type: "complete".to_string(),
                    current: 0,
                    total,
                    track_id: None,
                    error: Some(format!("Failed to get music folders: {}", e)),
                    result: Some(SavePendingEditsResponse {
                        success: false,
                        saved_count: 0,
                        errors: vec![],
                        rescan_recommended: false,
                        new_song_paths: vec![],
                    }),
                })
                .await;
            return;
        }
    };

    for (index, track_id) in request.track_ids.iter().enumerate() {
        // Emit progress event for starting this track
        let _ = tx
            .send(SaveProgressEvent {
                event_type: "progress".to_string(),
                current: index as i32,
                total,
                track_id: Some(track_id.clone()),
                error: None,
                result: None,
            })
            .await;

        // Process this track using the same logic as save_pending_edits
        let track_result = save_single_track(
            &state.pool,
            session_id,
            track_id,
            &request.path_overrides,
            request.target_music_folder_id,
            &music_folders,
            &cover_art_dir,
            &staging_dir,
            &rescan_keys,
            &user.username,
        )
        .await;

        match track_result {
            Ok(result) => {
                if result.needs_rescan {
                    rescan_recommended = true;
                }
                if let Some(path) = result.new_song_path {
                    new_song_ids.push(path);
                }
                if let Some(song_id) = result.library_song_id {
                    saved_library_song_ids.push(song_id);
                }
                saved_count += 1;
            }
            Err(error) => {
                errors.push(SessionSaveError {
                    track_id: track_id.clone(),
                    error,
                });
            }
        }
    }

    // Rescan library songs if needed
    if !saved_library_song_ids.is_empty() {
        let mut files_by_folder: std::collections::HashMap<i64, Vec<PathBuf>> =
            std::collections::HashMap::new();

        for song_id in &saved_library_song_ids {
            if let Ok(Some(song)) = queries::get_song_by_id(&state.pool, song_id).await {
                for folder in &music_folders {
                    let candidate = PathBuf::from(&folder.path).join(&song.file_path);
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

        for (folder_id, file_paths) in files_by_folder {
            if let Err(e) =
                crate::scanner::scan_specific_files(&state.pool, folder_id, file_paths.clone())
                    .await
            {
                tracing::warn!("Failed to rescan files for folder {}: {}", folder_id, e);
            }
        }
    }

    // Rescan new files (staged -> library)
    if !new_song_ids.is_empty() {
        if let Some(folder_id) = request.target_music_folder_id {
            if let Some(folder) = music_folders.iter().find(|f| f.id == folder_id) {
                let file_paths: Vec<PathBuf> = new_song_ids
                    .iter()
                    .map(|rel_path| PathBuf::from(&folder.path).join(rel_path))
                    .collect();

                if let Err(e) =
                    crate::scanner::scan_specific_files(&state.pool, folder_id, file_paths).await
                {
                    tracing::warn!("Failed to rescan new files: {}", e);
                }
            }
        }
    }

    // Log summary
    if !errors.is_empty() {
        tracing::warn!(
            "Save completed with {} errors out of {} tracks",
            errors.len(),
            saved_count as usize + errors.len()
        );
        for error in &errors {
            tracing::warn!("  - {}: {}", error.track_id, error.error);
        }
    }

    // Emit completion event
    let _ = tx
        .send(SaveProgressEvent {
            event_type: "complete".to_string(),
            current: total,
            total,
            track_id: None,
            error: None,
            result: Some(SavePendingEditsResponse {
                success: errors.is_empty(),
                saved_count,
                errors,
                rescan_recommended,
                new_song_paths: new_song_ids,
            }),
        })
        .await;
}

/// Result of saving a single track
struct SaveSingleTrackResult {
    needs_rescan: bool,
    new_song_path: Option<String>,
    library_song_id: Option<String>,
}

/// Save a single track - extracted from save_pending_edits for reuse
#[allow(clippy::too_many_arguments)]
async fn save_single_track(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    track_id: &str,
    path_overrides: &HashMap<String, String>,
    target_music_folder_id: Option<i64>,
    music_folders: &[crate::db::models::MusicFolder],
    cover_art_dir: &std::path::Path,
    staging_dir: &std::path::Path,
    rescan_keys: &[&str],
    username: &str,
) -> Result<SaveSingleTrackResult, String> {
    use crate::db::queries;

    let mut result = SaveSingleTrackResult {
        needs_rescan: false,
        new_song_path: None,
        library_song_id: None,
    };

    // First, determine if this is a staged or library track
    let track_type: Option<(String,)> = sqlx::query_as(
        "SELECT track_type FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?",
    )
    .bind(session_id)
    .bind(track_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    let track_type = match track_type {
        Some((t,)) => t,
        None => return Err("Track not in session".to_string()),
    };

    let is_staged = track_type == "staged";

    // Get the pending edit from database
    let pending: Option<PendingEditRow> = sqlx::query_as(
        r#"SELECT id, session_id, track_id, edited_tags, computed_path, 
                  cover_art_removed, cover_art_filename, replacement_audio_filename,
                  replacement_audio_original_name, created_at, updated_at
           FROM tagger_pending_edits 
           WHERE session_id = ? AND track_id = ?"#,
    )
    .bind(session_id)
    .bind(track_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    // For library tracks, pending edit is required. For staged tracks, it's optional.
    let pending = match pending {
        Some(p) => Some(p),
        None => {
            if !is_staged {
                // Library tracks must have pending edits
                return Err("No pending edits for this track".to_string());
            }
            // Staged files without pending edits can still be saved (just moved to library)
            None
        }
    };

    // Parse edited tags (empty if no pending edit)
    let edited_tags: HashMap<String, String> = pending
        .as_ref()
        .and_then(|p| serde_json::from_str(&p.edited_tags).ok())
        .unwrap_or_default();

    // Check if this update requires rescan
    if edited_tags
        .keys()
        .any(|k| rescan_keys.contains(&k.to_uppercase().as_str()))
    {
        result.needs_rescan = true;
    }

    if is_staged {
        // === STAGED FILE HANDLING ===
        let target_folder = match target_music_folder_id {
            Some(id) => match music_folders.iter().find(|f| f.id == id) {
                Some(f) => f,
                None => return Err("Target music folder not found".to_string()),
            },
            None => return Err("Target music folder required for staged files".to_string()),
        };

        let original_filename = if track_id.len() > 37 && track_id.chars().nth(36) == Some('_') {
            track_id[37..].to_string()
        } else {
            track_id.to_string()
        };

        let staging_path = staging_dir.join(track_id);
        if !staging_path.exists() {
            return Err("Staged file not found".to_string());
        }

        // Determine cover art action
        let cover_art_action = if pending.as_ref().is_some_and(|p| p.cover_art_removed) {
            super::tags::CoverArtAction::Remove
        } else if let Some(ref filename) =
            pending.as_ref().and_then(|p| p.cover_art_filename.as_ref())
        {
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
                Err(e) => return Err(format!("Failed to read cover art: {}", e)),
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

        // Apply tags and cover art to the staged file (only if there are changes)
        if !update_request.set.is_empty()
            || !matches!(cover_art_action, super::tags::CoverArtAction::Keep)
        {
            super::tags::update_tags_with_cover_art(
                &staging_path,
                &update_request,
                cover_art_action,
            )
            .await?;
        }

        // Clean up cover art staging file
        if let Some(filename) = pending.as_ref().and_then(|p| p.cover_art_filename.as_ref()) {
            let cover_art_path = cover_art_dir.join(filename);
            let _ = fs::remove_file(&cover_art_path).await;
        }

        // Determine target path
        let target_rel_path = path_overrides
            .get(track_id)
            .cloned()
            .or(pending.as_ref().and_then(|p| p.computed_path.clone()))
            .unwrap_or(original_filename);

        let target_path = resolve_path_within_music_folder(
            std::path::Path::new(&target_folder.path),
            &target_rel_path,
        )
        .await?;

        // Move file from staging to target
        move_file_cross_fs(&staging_path, &target_path)
            .await
            .map_err(|e| format!("Failed to move file: {}", e))?;

        // Remove from session tracks
        let _ =
            sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(pool)
                .await;

        // Clear the pending edit
        let _ =
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(pool)
                .await;

        result.new_song_path = Some(target_rel_path);
        result.needs_rescan = true;
    } else {
        // === LIBRARY FILE HANDLING ===
        let song = match queries::get_song_by_id(pool, track_id).await {
            Ok(Some(song)) => song,
            Ok(None) => return Err("Song not found in library".to_string()),
            Err(e) => return Err(format!("Database error: {}", e)),
        };

        // Find the file path and which music folder it's in
        let mut full_path: Option<PathBuf> = None;
        let mut folder_path: Option<PathBuf> = None;
        for folder in music_folders {
            let candidate = PathBuf::from(&folder.path).join(&song.file_path);
            if candidate.exists() {
                full_path = Some(candidate);
                folder_path = Some(PathBuf::from(&folder.path));
                break;
            }
        }

        let (current_path, folder) = match (full_path, folder_path) {
            (Some(p), Some(f)) => (p, f),
            _ => return Err("File not found on disk".to_string()),
        };

        let mut working_path = current_path.clone();

        // Track if audio was replaced with a different format (e.g. .opus -> .mp3)
        let mut replaced_ext: Option<String> = None;

        // Handle replacement audio if present
        // Note: For library tracks, pending is always Some (checked above)
        let pending_ref = pending.as_ref().unwrap();
        if let Some(ref replacement_filename) = pending_ref.replacement_audio_filename {
            let replacement_dir = get_replacement_audio_dir(username);
            let replacement_file_path = replacement_dir.join(replacement_filename);

            if replacement_file_path.exists() {
                // Read original file's tags and cover art for transfer
                let original_path_clone = current_path.clone();
                let original_data = tokio::task::spawn_blocking(move || {
                    use lofty::prelude::*;
                    use lofty::probe::Probe;

                    let tagged_file =
                        match Probe::open(&original_path_clone).and_then(|probe| probe.read()) {
                            Ok(f) => f,
                            Err(e) => {
                                tracing::warn!("Failed to read original file tags: {}", e);
                                return (Vec::new(), None);
                            }
                        };

                    let tags = if let Some(tag) = tagged_file.primary_tag() {
                        super::tags::extract_tags_from_tag(tag)
                    } else {
                        Vec::new()
                    };

                    let cover = tagged_file
                        .primary_tag()
                        .and_then(|tag| tag.pictures().first())
                        .or_else(|| {
                            tagged_file
                                .tags()
                                .iter()
                                .find_map(|tag| tag.pictures().first())
                        })
                        .map(|pic| {
                            let mime = pic
                                .mime_type()
                                .map_or_else(|| "image/jpeg".to_string(), |m| m.to_string());
                            (pic.data().to_vec(), mime)
                        });

                    (tags, cover)
                })
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!("Failed to spawn blocking task: {}", e);
                    (Vec::new(), None)
                });

                let new_ext = replacement_filename
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_lowercase();
                let old_ext = current_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let target_path = if new_ext != old_ext {
                    current_path.with_extension(&new_ext)
                } else {
                    current_path.clone()
                };

                let temp_path = target_path.with_extension(format!("{}.tmp", new_ext));

                // Copy replacement file
                let data = fs::read(&replacement_file_path)
                    .await
                    .map_err(|e| format!("Failed to read replacement audio: {}", e))?;
                fs::write(&temp_path, &data)
                    .await
                    .map_err(|e| format!("Failed to write temp file: {}", e))?;

                // Rename temp file to target
                fs::rename(&temp_path, &target_path)
                    .await
                    .map_err(|e| format!("Failed to rename temp file: {}", e))?;

                // Delete old file if extension changed
                if new_ext != old_ext && current_path.exists() {
                    let _ = fs::remove_file(&current_path).await;
                }

                working_path = target_path.clone();

                // Update database path and format if extension changed
                if new_ext != old_ext {
                    replaced_ext = Some(new_ext.clone());
                    let new_rel_path = if let Some(ext_pos) = song.file_path.rfind('.') {
                        format!("{}.{}", &song.file_path[..ext_pos], new_ext)
                    } else {
                        format!("{}.{}", song.file_path, new_ext)
                    };

                    if let Err(e) = queries::update_song_path_and_format(
                        pool,
                        track_id,
                        &new_rel_path,
                        &new_ext,
                    )
                    .await
                    {
                        tracing::warn!("Failed to update song path in DB: {}", e);
                    }
                }

                // Apply original tags to replacement file
                if !original_data.0.is_empty() {
                    let update_request = super::tags::UpdateTagsRequest {
                        set: original_data.0,
                        delete: vec![],
                    };

                    let cover_action = match original_data.1 {
                        Some((data, mime)) => super::tags::CoverArtAction::Set(data, mime),
                        None => super::tags::CoverArtAction::Keep,
                    };

                    if let Err(e) = super::tags::update_tags_with_cover_art(
                        &working_path,
                        &update_request,
                        cover_action,
                    )
                    .await
                    {
                        tracing::warn!("Failed to transfer original tags to replacement: {}", e);
                    }
                }

                // Clean up replacement audio staging file
                let _ = fs::remove_file(&replacement_file_path).await;

                result.needs_rescan = true;
            }
        }

        // Determine cover art action for edited cover
        let cover_art_action = if pending_ref.cover_art_removed {
            super::tags::CoverArtAction::Remove
        } else if let Some(ref filename) = pending_ref.cover_art_filename {
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
                Err(e) => return Err(format!("Failed to read cover art: {}", e)),
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

        // Apply tags and cover art
        super::tags::update_tags_with_cover_art(&working_path, &update_request, cover_art_action)
            .await?;

        // Clean up cover art staging file
        if let Some(ref filename) = pending_ref.cover_art_filename {
            let cover_art_path = cover_art_dir.join(filename);
            let _ = fs::remove_file(&cover_art_path).await;
        }

        // Handle file rename if computed_path is set
        if let Some(new_rel_path) = path_overrides
            .get(track_id)
            .cloned()
            .or(pending_ref.computed_path.clone())
        {
            // If audio was replaced with a different format, update the extension
            // in the rename path (computed_path was calculated before replacement)
            let new_rel_path = if let Some(ref ext) = replaced_ext {
                if let Some(pos) = new_rel_path.rfind('.') {
                    format!("{}.{}", &new_rel_path[..pos], ext)
                } else {
                    new_rel_path
                }
            } else {
                new_rel_path
            };

            // Compare against the current working path rather than stale song.file_path
            let current_rel_path = working_path
                .strip_prefix(&folder)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| song.file_path.clone());

            if new_rel_path != current_rel_path {
                let new_path = folder.join(&new_rel_path);

                // Security check
                if !new_path.starts_with(&folder) {
                    return Err("New path must be within music folder".to_string());
                }

                // Create parent directories
                if let Some(parent) = new_path.parent() {
                    fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("Failed to create directory: {}", e))?;
                }

                // Move the file
                move_file_cross_fs(&working_path, &new_path)
                    .await
                    .map_err(|e| format!("Failed to move file: {}", e))?;

                // Update database path (and format if audio was replaced)
                let db_result = if replaced_ext.is_some() {
                    let ext = working_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    queries::update_song_path_and_format(pool, track_id, &new_rel_path, &ext).await
                } else {
                    queries::update_song_path(pool, track_id, &new_rel_path).await
                };

                if let Err(e) = db_result {
                    // Try to rollback
                    let _ = move_file_cross_fs(&new_path, &working_path).await;
                    return Err(format!("Failed to update database: {}", e));
                }
            }
        }

        // Clear the pending edit (but keep track in session)
        let _ =
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(track_id)
                .execute(pool)
                .await;

        result.library_song_id = Some(track_id.to_string());
    }

    Ok(result)
}
