//! Tagger API endpoints for the Admin API.
//!
//! Provides endpoints for the tagger view: uploading files to staging,
//! batch tag operations, and saving changes.

use crate::api::common::fs_utils::move_file_cross_fs;
use crate::api::common::utils::get_content_type_for_format;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::queries;
use crate::error::{Error, FerrotuneApiResult};
use async_walkdir::WalkDir;
use axum::{
    body::Bytes,
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use futures_lite::StreamExt;
use lofty::config::ParseOptions;
use lofty::file::AudioFile;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::path::{Component, Path as StdPath};
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use ts_rs::TS;
use uuid::Uuid;

use super::server_config::is_tag_editing_enabled;
use super::tags::{extract_tags_from_file, GetTagsResponse, TagEntry, UpdateTagsRequest};

/// Response for listing staged files
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StagedFilesResponse {
    pub files: Vec<StagedFile>,
}

/// A staged file awaiting import
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StagedFile {
    pub id: String,
    pub original_filename: String,
    pub file_size: i64,
    pub duration_ms: Option<i64>,
    pub tags: Vec<TagEntry>,
    pub uploaded_at: String,
}

/// Response for upload operation
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UploadResponse {
    pub success: bool,
    pub files: Vec<StagedFile>,
    pub errors: Vec<UploadError>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UploadError {
    pub filename: String,
    pub error: String,
}

/// Request to add library tracks to tagger session
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StageLibraryTracksRequest {
    pub song_ids: Vec<String>,
}

/// Response for staging library tracks
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StageLibraryTracksResponse {
    pub tracks: Vec<TaggerTrack>,
}

/// A track in the tagger (either staged or from library)
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TaggerTrack {
    pub id: String,
    pub is_staged: bool,
    pub file_path: String,
    pub file_format: String,
    pub file_size: i64,
    pub duration_ms: Option<i64>,
    pub tags: Vec<TagEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_id: Option<String>,
    /// Music folder ID (None for staged files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_folder_id: Option<i64>,
    /// Music folder path (None for staged files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_folder_path: Option<String>,
}

/// Request to get tags for multiple songs
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchGetTagsRequest {
    #[serde(deserialize_with = "crate::api::subsonic::query::string_or_seq")]
    pub song_ids: Vec<String>,
}

/// Response for batch get tags
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchGetTagsResponse {
    pub results: Vec<BatchTagResult>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchTagResult {
    pub song_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<GetTagsResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Request to update tags for multiple songs
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchUpdateTagsRequest {
    pub updates: Vec<SongTagUpdate>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongTagUpdate {
    pub song_id: String,
    #[serde(flatten)]
    pub changes: UpdateTagsRequest,
    /// Cover art action: "keep" (default), "remove", or "set"
    #[serde(default)]
    pub cover_art_action: Option<String>,
    /// Cover art data (base64 encoded) if action is "set"
    pub cover_art_data: Option<String>,
    /// Cover art mime type if action is "set"
    pub cover_art_mime_type: Option<String>,
}

/// Response for batch update tags
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchUpdateTagsResponse {
    pub success: bool,
    pub updated_count: usize,
    pub errors: Vec<BatchUpdateError>,
    pub rescan_recommended: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchUpdateError {
    pub song_id: String,
    pub error: String,
}

/// Request to save staged files
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveStagedFilesRequest {
    /// Files to save (id -> target path mapping)
    pub files: Vec<StagedFileSave>,
    /// Whether to rescan after moving
    pub rescan: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StagedFileSave {
    pub staged_id: String,
    /// Relative path within music folder
    pub target_path: String,
    /// Music folder ID to save to
    pub music_folder_id: i64,
}

/// Response for save operation
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveStagedFilesResponse {
    pub success: bool,
    pub saved_count: usize,
    pub errors: Vec<SaveError>,
    pub new_song_ids: Vec<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveError {
    pub staged_id: String,
    pub error: String,
}

/// Request to rescan specific files
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RescanFilesRequest {
    pub song_ids: Vec<String>,
}

/// Response for rescan operation
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RescanFilesResponse {
    pub success: bool,
    pub rescanned_count: usize,
}

/// Request to rename/move files
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RenameFilesRequest {
    pub renames: Vec<RenameEntry>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RenameEntry {
    pub song_id: String,
    /// New relative path within the same music folder
    pub new_path: String,
    /// Target music folder ID (required for staged files, optional for library files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_music_folder_id: Option<i64>,
}

/// Response for rename operation
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RenameFilesResponse {
    pub success: bool,
    pub renamed_count: usize,
    pub errors: Vec<RenameError>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RenameError {
    pub song_id: String,
    pub error: String,
}

/// Request to check if rename paths would conflict with existing files
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CheckPathConflictsRequest {
    /// List of renames to check (same format as RenameFilesRequest)
    pub renames: Vec<RenameEntry>,
}

/// Response for path conflict check
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CheckPathConflictsResponse {
    /// List of conflicts found
    pub conflicts: Vec<PathConflict>,
}

/// Information about a path conflict
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PathConflict {
    /// Song ID that would conflict
    pub song_id: String,
    /// The path that was requested
    pub requested_path: String,
    /// Suggested alternative path (with number suffix)
    pub suggested_path: String,
}

/// Get staging directory for uploaded files for a user
pub fn get_staging_dir(_state: &AppState, user_id: &str) -> PathBuf {
    // Use a staging subdirectory in the data directory
    crate::config::get_data_dir()
        .join("staging")
        .join(user_id)
        .join("uploaded")
}

pub(crate) async fn resolve_path_within_music_folder(
    folder_path: &StdPath,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let rel = StdPath::new(relative_path);

    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::RootDir))
    {
        return Err("Path must be a relative path within the music folder".to_string());
    }

    let canonical_root = folder_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve music folder path: {}", e))?;

    let target_path = canonical_root.join(rel);
    let parent = target_path
        .parent()
        .ok_or_else(|| "Invalid target path".to_string())?;

    fs::create_dir_all(parent)
        .await
        .map_err(|e| format!("Failed to create directories: {}", e))?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Failed to resolve target directory path: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Target path escapes music folder".to_string());
    }

    Ok(target_path)
}

/// POST /ferrotune/tagger/upload
///
/// Upload audio files to staging area for editing.
pub async fn upload_files(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> FerrotuneApiResult<Json<UploadResponse>> {
    let staging_dir = get_staging_dir(&state, &user.username);

    // Ensure staging directory exists
    if let Err(e) = fs::create_dir_all(&staging_dir).await {
        return Err(Error::Internal(format!("Failed to create staging directory: {}", e)).into());
    }

    let mut uploaded_files = Vec::new();
    let mut errors = Vec::new();

    // Process each file in the multipart form
    while let Ok(Some(field)) = multipart.next_field().await {
        let filename = match field.file_name() {
            Some(name) => std::path::Path::new(name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            None => {
                errors.push(UploadError {
                    filename: "unknown".to_string(),
                    error: "Missing filename".to_string(),
                });
                continue;
            }
        };

        // Check if it's an audio file
        let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
        let valid_extensions = ["mp3", "flac", "ogg", "m4a", "opus", "wav", "aac", "wma"];
        if !valid_extensions.contains(&ext.as_str()) {
            errors.push(UploadError {
                filename,
                error: format!("Unsupported file type: {}", ext),
            });
            continue;
        }

        // Read file data
        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => {
                errors.push(UploadError {
                    filename,
                    error: format!("Failed to read file: {}", e),
                });
                continue;
            }
        };

        // Generate unique ID (file_id + filename) and save to staging
        let file_id = Uuid::new_v4().to_string();
        let staged_filename = format!("{}_{}", file_id, filename);
        let staging_path = staging_dir.join(&staged_filename);

        // Write to staging
        match save_file_to_staging(&staging_path, &data).await {
            Ok(()) => {}
            Err(e) => {
                errors.push(UploadError {
                    filename,
                    error: format!("Failed to save file: {}", e),
                });
                continue;
            }
        }

        // Extract tags and metadata
        let metadata = match extract_file_metadata(&staging_path).await {
            Ok(m) => m,
            Err(e) => {
                // Clean up staging file on metadata extraction failure
                let _ = fs::remove_file(&staging_path).await;
                errors.push(UploadError {
                    filename,
                    error: format!("Failed to read metadata: {}", e),
                });
                continue;
            }
        };

        // Success - staged file info is encoded in the filename itself
        // Format: {uuid}_{original_filename}
        uploaded_files.push(StagedFile {
            id: staged_filename, // Use filename as ID
            original_filename: filename,
            file_size: data.len() as i64,
            duration_ms: metadata.duration_ms,
            tags: metadata.tags,
            uploaded_at: chrono::Utc::now().to_rfc3339(),
        });
    }

    Ok(Json(UploadResponse {
        success: errors.is_empty(),
        files: uploaded_files,
        errors,
    }))
}

async fn save_file_to_staging(path: &PathBuf, data: &Bytes) -> Result<(), String> {
    let mut file = fs::File::create(path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(data)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    Ok(())
}

struct FileMetadata {
    duration_ms: Option<i64>,
    tags: Vec<TagEntry>,
}

async fn extract_file_metadata(path: &std::path::Path) -> Result<FileMetadata, String> {
    let path_clone = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let tagged_file = Probe::open(&path_clone)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .options(ParseOptions::new())
            .read()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let duration_ms = tagged_file
            .properties()
            .duration()
            .as_millis()
            .try_into()
            .ok();

        let tags = extract_tags_from_file(&tagged_file);

        Ok(FileMetadata { duration_ms, tags })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// GET /ferrotune/tagger/staged
///
/// List all staged files for the current user.
pub async fn list_staged_files(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<StagedFilesResponse>> {
    let staging_dir = get_staging_dir(&state, &user.username);

    // Ensure directory exists
    if !staging_dir.exists() {
        return Ok(Json(StagedFilesResponse { files: vec![] }));
    }

    let mut files = Vec::new();
    let mut entries = WalkDir::new(&staging_dir);

    while let Some(entry_result) = entries.next().await {
        match entry_result {
            Ok(entry) => {
                let path = entry.path();
                if path.is_dir() {
                    continue;
                }

                let filename = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };

                // Check extension
                let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
                let valid_extensions = ["mp3", "flac", "ogg", "m4a", "opus", "wav", "aac", "wma"];
                if !valid_extensions.contains(&ext.as_str()) {
                    continue;
                }

                // Get file metadata (size, time)

                let file_info = match fs::metadata(&path).await {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let file_size = file_info.len() as i64;
                let modified = file_info
                    .modified()
                    .unwrap_or_else(|_| std::time::SystemTime::now());
                let uploaded_at = DateTime::<Utc>::from(modified).to_rfc3339();

                // Extract tags and duration (blocking operation)
                let metadata_result = extract_file_metadata(&path).await;

                let (duration_ms, tags) = match metadata_result {
                    Ok(m) => (m.duration_ms, m.tags),
                    Err(_) => (None, vec![]),
                };

                // Parse ID and Original Filename
                // Expected format: {uuid}_{filename}
                // If not matching, treat whole filename as original_filename
                // This preserves behavior for manually copied files
                let original_filename =
                    if filename.len() > 37 && filename.chars().nth(36) == Some('_') {
                        filename[37..].to_string()
                    } else {
                        filename.clone()
                    };

                files.push(StagedFile {
                    id: filename, // Use filename as ID
                    original_filename,
                    file_size,
                    duration_ms,
                    tags,
                    uploaded_at,
                });
            }
            Err(e) => {
                tracing::warn!("Error walking staging directory: {}", e);
            }
        }
    }

    Ok(Json(StagedFilesResponse { files }))
}

/// Response for orphaned files discovery
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct OrphanedFilesResponse {
    /// Number of orphaned files found
    pub count: i64,
    /// Orphaned file IDs (staged filenames that are not in the session)
    pub file_ids: Vec<String>,
}

/// GET /ferrotune/tagger/orphaned
///
/// Discover orphaned files in the staging directory that are not in the current session.
/// This helps users find files they uploaded previously but didn't include in session.
pub async fn discover_orphaned_files(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<OrphanedFilesResponse>> {
    let staging_dir = get_staging_dir(&state, &user.username);

    // If staging dir doesn't exist, no orphaned files
    if !staging_dir.exists() {
        return Ok(Json(OrphanedFilesResponse {
            count: 0,
            file_ids: vec![],
        }));
    }

    // Get current session track IDs (staged tracks only)
    let session_track_ids: HashSet<String> =
        match crate::api::ferrotune::tagger_session::get_session_track_ids(
            &state.database,
            user.user_id,
        )
        .await
        {
            Ok(ids) => ids.into_iter().collect(),
            Err(_) => HashSet::new(),
        };

    let mut orphaned_ids = Vec::new();
    let mut entries = WalkDir::new(&staging_dir);

    while let Some(entry_result) = entries.next().await {
        match entry_result {
            Ok(entry) => {
                let path = entry.path();
                if path.is_dir() {
                    continue;
                }

                let filename = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };

                // Check extension
                let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
                let valid_extensions = ["mp3", "flac", "ogg", "m4a", "opus", "wav", "aac", "wma"];
                if !valid_extensions.contains(&ext.as_str()) {
                    continue;
                }

                // Check if this file is in the session
                if !session_track_ids.contains(&filename) {
                    orphaned_ids.push(filename);
                }
            }
            Err(e) => {
                tracing::warn!("Error walking staging directory: {}", e);
            }
        }
    }

    let count = orphaned_ids.len() as i64;
    Ok(Json(OrphanedFilesResponse {
        count,
        file_ids: orphaned_ids,
    }))
}

/// DELETE /ferrotune/tagger/staged/:id
///
/// Remove a staged file.
pub async fn delete_staged_file(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    let staging_dir = get_staging_dir(&state, &user.username);

    // Sanitize ID (which is filename) to prevent directory traversal
    let filename = PathBuf::from(&id);
    if filename.to_string_lossy().contains("..")
        || filename.to_string_lossy().contains('/')
        || filename.to_string_lossy().contains('\\')
    {
        return Err(Error::InvalidRequest(
            "Invalid filename: Path navigation not allowed".to_string(),
        )
        .into());
    }

    let file_path = staging_dir.join(&id);

    if !file_path.exists() {
        return Err(Error::NotFound("File not found on disk".to_string()).into());
    }

    // Delete the staged file
    if let Err(e) = fs::remove_file(&file_path).await {
        return Err(Error::Internal(format!("Failed to delete file: {}", e)).into());
    }

    // Clean up any associated cover art and pending edits
    if let Ok(session_id) =
        crate::api::ferrotune::tagger_session::get_or_create_session(&state.database, user.user_id)
            .await
    {
        // Get the cover art filename from pending edits
        let cover_art_filename: Option<(Option<String>,)> = if let Ok(pool) =
            state.database.sqlite_pool()
        {
            sqlx::query_as(
                "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?",
            )
            .bind(session_id)
            .bind(&id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
        } else {
            match state.database.postgres_pool() {
                Ok(pool) => {
                    sqlx::query_as(
                        "SELECT cover_art_filename FROM tagger_pending_edits WHERE session_id = $1 AND track_id = $2",
                    )
                    .bind(session_id)
                    .bind(&id)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten()
                }
                Err(_) => None,
            }
        };

        // Delete cover art file if it exists
        if let Some((Some(filename),)) = cover_art_filename {
            let cover_art_dir = crate::config::get_data_dir()
                .join("staging")
                .join(&user.username)
                .join("cover_art");
            let cover_art_path = cover_art_dir.join(&filename);
            if cover_art_path.exists() {
                let _ = fs::remove_file(&cover_art_path).await;
            }
        }

        // Delete the pending edit record
        let _ = if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(&id)
                .execute(pool)
                .await
                .map(|result| result.rows_affected())
        } else if let Ok(pool) = state.database.postgres_pool() {
            sqlx::query("DELETE FROM tagger_pending_edits WHERE session_id = $1 AND track_id = $2")
                .bind(session_id)
                .bind(&id)
                .execute(pool)
                .await
                .map(|result| result.rows_affected())
        } else {
            Ok(0)
        };

        // Also remove from session tracks
        let _ = if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = ? AND track_id = ?")
                .bind(session_id)
                .bind(&id)
                .execute(pool)
                .await
                .map(|result| result.rows_affected())
        } else if let Ok(pool) = state.database.postgres_pool() {
            sqlx::query("DELETE FROM tagger_session_tracks WHERE session_id = $1 AND track_id = $2")
                .bind(session_id)
                .bind(&id)
                .execute(pool)
                .await
                .map(|result| result.rows_affected())
        } else {
            Ok(0)
        };
    }

    // Success (No Content)
    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/tagger/staged/:id/stream
///
/// Stream a staged file for preview playback.
pub async fn stream_staged_file(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> FerrotuneApiResult<impl IntoResponse> {
    use axum::http::header;
    use tokio::io::AsyncReadExt;

    let staging_dir = get_staging_dir(&state, &user.username);

    // Sanitize ID (which is filename) to prevent directory traversal
    let filename = PathBuf::from(&id);
    if filename.to_string_lossy().contains("..")
        || filename.to_string_lossy().contains('/')
        || filename.to_string_lossy().contains('\\')
    {
        return Err(Error::InvalidRequest(
            "Invalid filename: Path navigation not allowed".to_string(),
        )
        .into());
    }

    let file_path = staging_dir.join(&id);

    if !file_path.exists() {
        return Err(Error::NotFound("File not found on disk".to_string()).into());
    }

    // Get file metadata
    let metadata = match fs::metadata(&file_path).await {
        Ok(m) => m,
        Err(e) => {
            return Err(Error::Internal(format!("Failed to read file metadata: {}", e)).into());
        }
    };

    let file_size = metadata.len();

    // Determine content type from extension
    let ext = id.rsplit('.').next().unwrap_or("").to_lowercase();
    let content_type = get_content_type_for_format(&ext);

    // Parse Range header for partial content
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let (start, end) = if let Some(range) = range_header {
        // Parse "bytes=start-end" format
        if let Some(range_value) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_value.split('-').collect();
            let start: u64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
            let end: u64 = parts
                .get(1)
                .and_then(|s| if s.is_empty() { None } else { s.parse().ok() })
                .unwrap_or(file_size - 1)
                .min(file_size - 1);
            (start, end)
        } else {
            (0, file_size - 1)
        }
    } else {
        (0, file_size - 1)
    };

    let length = end - start + 1;

    // Open and seek to start position
    let mut file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            return Err(Error::Internal(format!("Failed to open file: {}", e)).into());
        }
    };

    // Seek to start position
    if start > 0 {
        use tokio::io::AsyncSeekExt;
        if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
            return Err(Error::Internal(format!("Failed to seek in file: {}", e)).into());
        }
    }

    // Read the requested range
    let mut buffer = vec![0u8; length as usize];
    if let Err(e) = file.read_exact(&mut buffer).await {
        return Err(Error::Internal(format!("Failed to read file: {}", e)).into());
    }

    // Build response headers
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    response_headers.insert(header::CONTENT_LENGTH, length.to_string().parse().unwrap());
    response_headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    response_headers.insert(
        header::CONTENT_RANGE,
        format!("bytes {}-{}/{}", start, end, file_size)
            .parse()
            .unwrap(),
    );

    // Return partial content or full content based on range request
    let status = if range_header.is_some() && (start > 0 || end < file_size - 1) {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };

    Ok((status, response_headers, buffer).into_response())
}

/// GET /ferrotune/tagger/staged/:id/cover
///
/// Get embedded cover art from a staged audio file.
pub async fn get_staged_cover_art(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let staging_dir = get_staging_dir(&state, &user.username);

    // Sanitize ID (which is filename) to prevent directory traversal
    let filename = PathBuf::from(&id);
    if filename.to_string_lossy().contains("..")
        || filename.to_string_lossy().contains('/')
        || filename.to_string_lossy().contains('\\')
    {
        return Err(Error::InvalidRequest(
            "Invalid filename: Path navigation not allowed".to_string(),
        )
        .into());
    }

    let file_path = staging_dir.join(&id);

    if !file_path.exists() {
        return Err(Error::NotFound("File not found on disk".to_string()).into());
    }

    // Extract embedded cover art using thumbnails module
    match crate::thumbnails::extract_embedded_cover_art(&file_path).await {
        Ok(data) => {
            // Detect image type from magic bytes
            let content_type = if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                "image/png"
            } else if data.starts_with(&[0x47, 0x49, 0x46]) {
                "image/gif"
            } else if data.starts_with(b"RIFF") && data.len() > 12 && &data[8..12] == b"WEBP" {
                "image/webp"
            } else {
                "image/jpeg"
            };

            Ok((
                [
                    (axum::http::header::CONTENT_TYPE, content_type.to_string()),
                    (
                        axum::http::header::CACHE_CONTROL,
                        "max-age=86400".to_string(),
                    ),
                ],
                data,
            )
                .into_response())
        }
        Err(_) => Err(Error::NotFound("No cover art found".to_string()).into()),
    }
}

/// POST /ferrotune/tagger/stage-library
///
/// Add library tracks to tagger session (get their tags).
pub async fn stage_library_tracks(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StageLibraryTracksRequest>,
) -> FerrotuneApiResult<Json<StageLibraryTracksResponse>> {
    let mut tracks = Vec::new();

    // Get music folders once
    let music_folders = match queries::get_music_folders(&state.database).await {
        Ok(folders) => folders,
        Err(e) => return Err(Error::Database(e).into()),
    };

    for song_id in &request.song_ids {
        // Get song from database
        let song = match queries::get_song_by_id(&state.database, song_id).await {
            Ok(Some(song)) => song,
            Ok(None) => continue,
            Err(_) => continue,
        };

        // Find which folder this song belongs to
        let mut full_path: Option<PathBuf> = None;
        let mut found_folder: Option<&crate::db::models::MusicFolder> = None;
        for folder in &music_folders {
            let candidate = PathBuf::from(&folder.path).join(&song.file_path);
            if candidate.exists() {
                full_path = Some(candidate);
                found_folder = Some(folder);
                break;
            }
        }

        let (full_path, folder) = match (full_path, found_folder) {
            (Some(p), Some(f)) => (p, f),
            _ => continue,
        };

        // Extract tags
        let metadata = match extract_file_metadata(&full_path).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        tracks.push(TaggerTrack {
            id: song.id.clone(),
            is_staged: false,
            file_path: song.file_path,
            file_format: song.file_format,
            file_size: song.file_size,
            duration_ms: metadata.duration_ms,
            tags: metadata.tags,
            cover_art_id: song.cover_art_hash,
            music_folder_id: Some(folder.id),
            music_folder_path: Some(folder.path.clone()),
        });
    }

    Ok(Json(StageLibraryTracksResponse { tracks }))
}

/// POST /ferrotune/tagger/batch-tags
///
/// Get tags for multiple songs at once.
pub async fn batch_get_tags(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(request): Query<BatchGetTagsRequest>,
) -> FerrotuneApiResult<Json<BatchGetTagsResponse>> {
    let mut results = Vec::new();

    for song_id in &request.song_ids {
        // Get song and file path
        let song = match queries::get_song_by_id(&state.database, song_id).await {
            Ok(Some(song)) => song,
            Ok(None) => {
                results.push(BatchTagResult {
                    song_id: song_id.clone(),
                    tags: None,
                    error: Some("Song not found".to_string()),
                });
                continue;
            }
            Err(e) => {
                results.push(BatchTagResult {
                    song_id: song_id.clone(),
                    tags: None,
                    error: Some(format!("Database error: {}", e)),
                });
                continue;
            }
        };

        // Get file path
        let music_folders = match queries::get_music_folders(&state.database).await {
            Ok(folders) => folders,
            Err(e) => {
                results.push(BatchTagResult {
                    song_id: song_id.clone(),
                    tags: None,
                    error: Some(format!("Failed to get music folders: {}", e)),
                });
                continue;
            }
        };

        let mut full_path: Option<PathBuf> = None;
        for folder in music_folders {
            let candidate = PathBuf::from(&folder.path).join(&song.file_path);
            if candidate.exists() {
                full_path = Some(candidate);
                break;
            }
        }

        let full_path = match full_path {
            Some(p) => p,
            None => {
                results.push(BatchTagResult {
                    song_id: song_id.clone(),
                    tags: None,
                    error: Some("File not found on disk".to_string()),
                });
                continue;
            }
        };

        // Extract tags
        let metadata = match extract_file_metadata(&full_path).await {
            Ok(m) => m,
            Err(e) => {
                results.push(BatchTagResult {
                    song_id: song_id.clone(),
                    tags: None,
                    error: Some(e),
                });
                continue;
            }
        };

        results.push(BatchTagResult {
            song_id: song_id.clone(),
            tags: Some(GetTagsResponse {
                id: song.id,
                file_path: song.file_path,
                file_format: song.file_format,
                editing_enabled: is_tag_editing_enabled(&state).await,
                tag_type: None,
                tags: metadata.tags,
                additional_tags: vec![],
            }),
            error: None,
        });
    }

    Ok(Json(BatchGetTagsResponse { results }))
}

/// PATCH /ferrotune/tagger/batch-tags
///
/// Update tags for multiple songs at once.
pub async fn batch_update_tags(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<BatchUpdateTagsRequest>,
) -> FerrotuneApiResult<Json<BatchUpdateTagsResponse>> {
    // Check if editing is enabled
    if !is_tag_editing_enabled(&state).await {
        return Err(Error::Forbidden("Tag editing is disabled".to_string()).into());
    }

    let mut updated_count = 0;
    let mut errors = Vec::new();
    let mut rescan_recommended = false;

    // Keys that affect library organization
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

    for update in &request.updates {
        // Check if this update requires rescan
        let needs_rescan = update
            .changes
            .set
            .iter()
            .any(|t| rescan_keys.contains(&t.key.to_uppercase().as_str()))
            || update
                .changes
                .delete
                .iter()
                .any(|k| rescan_keys.contains(&k.to_uppercase().as_str()));
        if needs_rescan {
            rescan_recommended = true;
        }

        // Get song and file path
        let song = match queries::get_song_by_id(&state.database, &update.song_id).await {
            Ok(Some(song)) => song,
            Ok(None) => {
                errors.push(BatchUpdateError {
                    song_id: update.song_id.clone(),
                    error: "Song not found".to_string(),
                });
                continue;
            }
            Err(e) => {
                errors.push(BatchUpdateError {
                    song_id: update.song_id.clone(),
                    error: format!("Database error: {}", e),
                });
                continue;
            }
        };

        // Get file path
        let music_folders = match queries::get_music_folders(&state.database).await {
            Ok(folders) => folders,
            Err(e) => {
                errors.push(BatchUpdateError {
                    song_id: update.song_id.clone(),
                    error: format!("Failed to get music folders: {}", e),
                });
                continue;
            }
        };

        let mut full_path: Option<PathBuf> = None;
        for folder in music_folders {
            let candidate = PathBuf::from(&folder.path).join(&song.file_path);
            if candidate.exists() {
                full_path = Some(candidate);
                break;
            }
        }

        let full_path = match full_path {
            Some(p) => p,
            None => {
                errors.push(BatchUpdateError {
                    song_id: update.song_id.clone(),
                    error: "File not found on disk".to_string(),
                });
                continue;
            }
        };

        // Determine cover art action
        let cover_art_action = match update.cover_art_action.as_deref() {
            Some("remove") => super::tags::CoverArtAction::Remove,
            Some("set") => {
                // Decode base64 cover art data
                match (&update.cover_art_data, &update.cover_art_mime_type) {
                    (Some(data_b64), Some(mime)) => {
                        use base64::Engine;
                        match base64::engine::general_purpose::STANDARD.decode(data_b64) {
                            Ok(data) => super::tags::CoverArtAction::Set(data, mime.clone()),
                            Err(e) => {
                                errors.push(BatchUpdateError {
                                    song_id: update.song_id.clone(),
                                    error: format!("Invalid cover art base64: {}", e),
                                });
                                continue;
                            }
                        }
                    }
                    _ => {
                        errors.push(BatchUpdateError {
                            song_id: update.song_id.clone(),
                            error: "Cover art data and mime type required for set action"
                                .to_string(),
                        });
                        continue;
                    }
                }
            }
            _ => super::tags::CoverArtAction::Keep,
        };

        // Apply tag changes with cover art support
        match super::tags::update_tags_with_cover_art(&full_path, &update.changes, cover_art_action)
            .await
        {
            Ok(_) => {
                updated_count += 1;
            }
            Err(e) => {
                errors.push(BatchUpdateError {
                    song_id: update.song_id.clone(),
                    error: e,
                });
            }
        }
    }

    Ok(Json(BatchUpdateTagsResponse {
        success: errors.is_empty(),
        updated_count,
        errors,
        rescan_recommended,
    }))
}

/// POST /ferrotune/tagger/save
///
/// Save staged files to library with optional renaming.
pub async fn save_staged_files(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<SaveStagedFilesRequest>,
) -> FerrotuneApiResult<Json<SaveStagedFilesResponse>> {
    let mut saved_count = 0;
    let mut errors = Vec::new();
    let mut new_song_ids = Vec::new();
    let staging_dir = get_staging_dir(&state, &user.username);

    for file_save in &request.files {
        // The staged file ID is the filename in format: {uuid}_{original_filename}
        // The staging path is just the staging directory + the ID
        let staging_path = staging_dir.join(&file_save.staged_id);

        if !staging_path.exists() {
            errors.push(SaveError {
                staged_id: file_save.staged_id.clone(),
                error: "Staged file not found".to_string(),
            });
            continue;
        }

        // Get target music folder
        let music_folders = match queries::get_music_folders(&state.database).await {
            Ok(folders) => folders,
            Err(e) => {
                errors.push(SaveError {
                    staged_id: file_save.staged_id.clone(),
                    error: format!("Database error: {}", e),
                });
                continue;
            }
        };

        let music_folder = match music_folders
            .into_iter()
            .find(|f| f.id == file_save.music_folder_id)
        {
            Some(folder) => folder,
            None => {
                errors.push(SaveError {
                    staged_id: file_save.staged_id.clone(),
                    error: "Music folder not found".to_string(),
                });
                continue;
            }
        };

        // Build and validate target path
        let target_path = match resolve_path_within_music_folder(
            StdPath::new(&music_folder.path),
            &file_save.target_path,
        )
        .await
        {
            Ok(path) => path,
            Err(e) => {
                errors.push(SaveError {
                    staged_id: file_save.staged_id.clone(),
                    error: e,
                });
                continue;
            }
        };

        // Move file from staging to target (with cross-filesystem support)
        if let Err(e) = move_file_cross_fs(&staging_path, &target_path).await {
            errors.push(SaveError {
                staged_id: file_save.staged_id.clone(),
                error: format!("Failed to move file: {}", e),
            });
            continue;
        }

        saved_count += 1;

        // If rescan requested, we'll add the new song to the library
        // For now, just track that we saved it - actual rescan happens separately
        new_song_ids.push(file_save.staged_id.clone());
    }

    // Trigger rescan if requested
    if request.rescan && !new_song_ids.is_empty() {
        // This would trigger a partial scan of the saved files
        // For now, we just return success and the client can trigger a scan
    }

    Ok(Json(SaveStagedFilesResponse {
        success: errors.is_empty(),
        saved_count,
        errors,
        new_song_ids,
    }))
}

/// POST /ferrotune/tagger/rescan
///
/// Rescan specific songs after tag changes.
pub async fn rescan_files(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RescanFilesRequest>,
) -> FerrotuneApiResult<Json<RescanFilesResponse>> {
    // Group files by folder for efficient scanning
    let mut files_by_folder: std::collections::HashMap<i64, Vec<PathBuf>> =
        std::collections::HashMap::new();

    // Get music folders once
    let music_folders = match queries::get_music_folders(&state.database).await {
        Ok(folders) => folders,
        Err(e) => {
            return Err(Error::Internal(format!("Failed to get music folders: {}", e)).into())
        }
    };

    // Get file paths for each song and group by folder
    for song_id in &request.song_ids {
        let song = match queries::get_song_by_id(&state.database, song_id).await {
            Ok(Some(song)) => song,
            _ => continue,
        };

        // Find which folder contains this file
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

    if files_by_folder.is_empty() {
        return Ok(Json(RescanFilesResponse {
            success: true,
            rescanned_count: 0,
        }));
    }

    let mut rescanned_count = 0;

    // Scan files grouped by folder
    for (folder_id, file_paths) in files_by_folder {
        match crate::scanner::scan_specific_files(&state.database, folder_id, file_paths.clone())
            .await
        {
            Ok(()) => {
                rescanned_count += file_paths.len();
            }
            Err(e) => {
                tracing::warn!("Failed to rescan files for folder {}: {}", folder_id, e);
            }
        }
    }

    Ok(Json(RescanFilesResponse {
        success: true,
        rescanned_count,
    }))
}

/// POST /ferrotune/tagger/rename
///
/// Rename/move library files to new paths.
pub async fn rename_files(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RenameFilesRequest>,
) -> FerrotuneApiResult<Json<RenameFilesResponse>> {
    // Check if editing is enabled
    if !is_tag_editing_enabled(&state).await {
        return Err(Error::Forbidden(
            "Library editing is disabled: Enable tag editing in server configuration".to_string(),
        )
        .into());
    }

    let mut errors: Vec<RenameError> = Vec::new();
    let mut renamed_count = 0;

    // Get music folders for path resolution
    let music_folders = match queries::get_music_folders(&state.database).await {
        Ok(folders) => folders,
        Err(e) => {
            return Err(Error::Internal(format!("Failed to get music folders: {}", e)).into())
        }
    };

    for entry in &request.renames {
        // Get the song from database
        let song = match queries::get_song_by_id(&state.database, &entry.song_id).await {
            Ok(Some(s)) => s,
            Ok(None) => {
                errors.push(RenameError {
                    song_id: entry.song_id.clone(),
                    error: "Song not found".to_string(),
                });
                continue;
            }
            Err(e) => {
                errors.push(RenameError {
                    song_id: entry.song_id.clone(),
                    error: format!("Database error: {}", e),
                });
                continue;
            }
        };

        // Find the music folder and current file path
        let mut current_path: Option<PathBuf> = None;
        let mut folder_path: Option<PathBuf> = None;

        for folder in &music_folders {
            let candidate = PathBuf::from(&folder.path).join(&song.file_path);
            if candidate.exists() {
                current_path = Some(candidate);
                folder_path = Some(PathBuf::from(&folder.path));
                break;
            }
        }

        let (current, folder) = match (current_path, folder_path) {
            (Some(c), Some(f)) => (c, f),
            _ => {
                errors.push(RenameError {
                    song_id: entry.song_id.clone(),
                    error: "File not found on disk".to_string(),
                });
                continue;
            }
        };

        // Calculate and validate new absolute path
        let new_path =
            match resolve_path_within_music_folder(folder.as_path(), &entry.new_path).await {
                Ok(path) => path,
                Err(_) => {
                    errors.push(RenameError {
                        song_id: entry.song_id.clone(),
                        error: "New path must be within music folder".to_string(),
                    });
                    continue;
                }
            };

        let new_relative_path = match new_path.strip_prefix(&folder) {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) => {
                errors.push(RenameError {
                    song_id: entry.song_id.clone(),
                    error: "Failed to build relative path for database update".to_string(),
                });
                continue;
            }
        };

        if new_relative_path.is_empty() {
            errors.push(RenameError {
                song_id: entry.song_id.clone(),
                error: "New path must be within music folder".to_string(),
            });
            continue;
        }

        // Move the file (with cross-filesystem support)
        if let Err(e) = move_file_cross_fs(&current, &new_path).await {
            errors.push(RenameError {
                song_id: entry.song_id.clone(),
                error: format!("Failed to move file: {}", e),
            });
            continue;
        }

        // Update database path
        if let Err(e) =
            queries::update_song_path(&state.database, &entry.song_id, &new_relative_path).await
        {
            // Try to rollback the file move
            let _ = move_file_cross_fs(&new_path, &current).await;
            errors.push(RenameError {
                song_id: entry.song_id.clone(),
                error: format!("Failed to update database: {}", e),
            });
            continue;
        }

        renamed_count += 1;
    }

    Ok(Json(RenameFilesResponse {
        success: errors.is_empty(),
        renamed_count,
        errors,
    }))
}

/// POST /ferrotune/tagger/check-conflicts
///
/// Check if any of the proposed rename paths would conflict with existing files.
/// Returns a list of conflicts with suggested alternative paths.
/// Supports both library tracks (looks up by song_id) and staged tracks (uses target_music_folder_id).
pub async fn check_path_conflicts(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CheckPathConflictsRequest>,
) -> FerrotuneApiResult<Json<CheckPathConflictsResponse>> {
    let mut conflicts: Vec<PathConflict> = Vec::new();

    // Get music folders for path resolution
    let music_folders = match queries::get_music_folders(&state.database).await {
        Ok(folders) => folders,
        Err(e) => {
            return Err(Error::Internal(format!("Failed to get music folders: {}", e)).into())
        }
    };

    // Track which paths we're checking to detect conflicts within the batch itself
    let mut pending_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    for entry in &request.renames {
        // Try to determine the music folder:
        // 1. For library tracks: look up the song and find its folder
        // 2. For staged tracks: use the provided target_music_folder_id
        let folder: PathBuf;

        // First try to get the song from database (for library tracks)
        if let Ok(Some(song)) = queries::get_song_by_id(&state.database, &entry.song_id).await {
            // Library track - find its music folder
            let mut found_folder: Option<PathBuf> = None;
            for mf in &music_folders {
                let candidate = PathBuf::from(&mf.path).join(&song.file_path);
                if candidate.exists() {
                    found_folder = Some(PathBuf::from(&mf.path));
                    break;
                }
            }
            match found_folder {
                Some(f) => folder = f,
                None => continue, // Skip if folder not found
            }
        } else {
            // Not a library track - must be staged, use target_music_folder_id
            match entry.target_music_folder_id {
                Some(folder_id) => {
                    match music_folders.iter().find(|f| f.id == folder_id) {
                        Some(mf) => folder = PathBuf::from(&mf.path),
                        None => continue, // Skip if folder not found
                    }
                }
                None => continue, // Skip if no target folder specified for staged track
            }
        }

        // Calculate target absolute path
        let target_path = folder.join(&entry.new_path);

        // Check if file exists or is in our pending list
        let has_conflict = target_path.exists() || pending_paths.contains(&target_path);

        if has_conflict {
            // Find a non-conflicting alternative by appending (1), (2), etc.
            let suggested = find_non_conflicting_path(&target_path, &pending_paths);
            let suggested_relative = suggested
                .strip_prefix(&folder)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| entry.new_path.clone());

            conflicts.push(PathConflict {
                song_id: entry.song_id.clone(),
                requested_path: entry.new_path.clone(),
                suggested_path: suggested_relative,
            });

            // Add the suggested path to pending (user might accept it)
            pending_paths.insert(suggested);
        } else {
            // No conflict, add to pending
            pending_paths.insert(target_path);
        }
    }

    Ok(Json(CheckPathConflictsResponse { conflicts }))
}

/// Find a non-conflicting path by appending (1), (2), etc. before the extension
fn find_non_conflicting_path(
    path: &std::path::Path,
    pending: &std::collections::HashSet<PathBuf>,
) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let parent = path.parent().unwrap_or(std::path::Path::new(""));

    let mut counter = 1;
    loop {
        let new_name = format!("{} ({}){}", stem, counter, ext);
        let candidate = parent.join(&new_name);

        if !candidate.exists() && !pending.contains(&candidate) {
            return candidate;
        }

        counter += 1;
        if counter > 1000 {
            // Safety limit
            return candidate;
        }
    }
}

// =============================================================================
// Song Metadata for Rename Script Comparison
// =============================================================================

/// Lightweight song metadata for rename script path comparison
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongPathMetadata {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub genre: String,
    pub year: String,
    pub track_number: String,
    pub track_total: String,
    pub disc_number: String,
    pub disc_total: String,
    pub ext: String,
}

/// Response for the song paths endpoint
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongPathsResponse {
    pub songs: Vec<SongPathMetadata>,
}

#[derive(sqlx::FromRow)]
struct SongPathRow {
    id: String,
    file_path: String,
    title: String,
    artist_name: String,
    file_format: String,
    album_name: Option<String>,
    track_number: Option<i32>,
    disc_number: i32,
    year: Option<i32>,
    genre: Option<String>,
    album_artist_name: Option<String>,
}

/// GET /ferrotune/tagger/song-paths
///
/// Returns lightweight metadata for all library songs, intended for client-side
/// rename script comparison to find songs whose paths don't match the script.
pub async fn get_song_paths(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SongPathsResponse>> {
    // Query all songs with artist and album info in a single query
    let rows = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as::<_, SongPathRow>(
            r#"
        SELECT s.id, s.file_path, s.title, ar.name as artist_name, s.file_format,
               al.name as album_name, s.track_number, s.disc_number, s.year, s.genre,
               aa.name as album_artist_name
        FROM songs s
        LEFT JOIN artists ar ON s.artist_id = ar.id
        LEFT JOIN albums al ON s.album_id = al.id
        LEFT JOIN artists aa ON al.artist_id = aa.id
        WHERE NOT EXISTS (
            SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id
        )
        ORDER BY s.file_path
        "#,
        )
        .fetch_all(pool)
        .await
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as::<_, SongPathRow>(
            r#"
        SELECT s.id, s.file_path, s.title, ar.name as artist_name, s.file_format,
               al.name as album_name, s.track_number, s.disc_number, s.year, s.genre,
               aa.name as album_artist_name
        FROM songs s
        LEFT JOIN artists ar ON s.artist_id = ar.id
        LEFT JOIN albums al ON s.album_id = al.id
        LEFT JOIN artists aa ON al.artist_id = aa.id
        WHERE NOT EXISTS (
            SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id
        )
        ORDER BY s.file_path
        "#,
        )
        .fetch_all(pool)
        .await
    }
    .map_err(|e| Error::Internal(format!("Failed to fetch songs: {}", e)))?;

    let songs: Vec<SongPathMetadata> = rows
        .into_iter()
        .map(|row| SongPathMetadata {
            id: row.id,
            file_path: row.file_path,
            title: row.title,
            artist: row.artist_name.clone(),
            album_artist: row.album_artist_name.unwrap_or(row.artist_name),
            album: row.album_name.unwrap_or_default(),
            genre: row.genre.unwrap_or_default(),
            year: row.year.map(|y| y.to_string()).unwrap_or_default(),
            track_number: row.track_number.map(|n| n.to_string()).unwrap_or_default(),
            track_total: String::new(),
            disc_number: row.disc_number.to_string(),
            disc_total: String::new(),
            ext: row.file_format,
        })
        .collect();

    Ok(Json(SongPathsResponse { songs }))
}
