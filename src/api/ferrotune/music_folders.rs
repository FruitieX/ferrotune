//! Music folder management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow managing multiple music libraries (music folders).
//! Each music folder can be independently enabled/disabled and scanned.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::models::MusicFolder;
use crate::error::{Error, Result};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Response containing a list of music folders.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFoldersResponse {
    pub music_folders: Vec<MusicFolderInfo>,
}

/// Information about a single music folder.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFolderInfo {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub path: String,
    pub enabled: bool,
    #[ts(type = "string | null")]
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub scan_error: Option<String>,
    /// Statistics for this folder
    pub stats: MusicFolderStats,
}

/// Statistics for a music folder.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFolderStats {
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub album_count: i64,
    #[ts(type = "number")]
    pub artist_count: i64,
    #[ts(type = "number")]
    pub total_duration_seconds: i64,
    #[ts(type = "number")]
    pub total_size_bytes: i64,
}

/// Request to create a new music folder.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateMusicFolderRequest {
    pub name: String,
    pub path: String,
}

/// Request to update a music folder.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateMusicFolderRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
}

/// Response after creating a music folder.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateMusicFolderResponse {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub path: String,
}

/// GET /ferrotune/music-folders - List all music folders with stats
pub async fn list_music_folders(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<MusicFoldersResponse>> {
    let folders = get_all_music_folders_with_stats(&state).await?;
    Ok(Json(MusicFoldersResponse {
        music_folders: folders,
    }))
}

/// GET /ferrotune/music-folders/{id} - Get a single music folder with stats
pub async fn get_music_folder(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<MusicFolderInfo>> {
    let folder = get_music_folder_with_stats(&state, id).await?;
    match folder {
        Some(f) => Ok(Json(f)),
        None => Err(Error::NotFound(format!("Music folder {} not found", id))),
    }
}

/// POST /ferrotune/music-folders - Create a new music folder
pub async fn create_music_folder(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateMusicFolderRequest>,
) -> Result<impl IntoResponse> {
    // Validate the path exists
    let path = std::path::Path::new(&request.path);
    if !path.exists() {
        return Err(Error::InvalidRequest(format!(
            "Path does not exist: {}",
            request.path
        )));
    }
    if !path.is_dir() {
        return Err(Error::InvalidRequest(format!(
            "Path is not a directory: {}",
            request.path
        )));
    }

    // Check if path is already registered
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE path = ?")
        .bind(&request.path)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(Error::InvalidRequest(format!(
            "Path is already registered as a music folder: {}",
            request.path
        )));
    }

    // Create the folder
    let result = sqlx::query("INSERT INTO music_folders (name, path, enabled) VALUES (?, ?, 1)")
        .bind(&request.name)
        .bind(&request.path)
        .execute(&state.pool)
        .await?;

    let id = result.last_insert_rowid();

    // Grant access to the current user for the new music folder
    sqlx::query(
        "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
    )
    .bind(user.user_id)
    .bind(id)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateMusicFolderResponse {
            id,
            name: request.name,
            path: request.path,
        }),
    ))
}

/// PATCH /ferrotune/music-folders/{id} - Update a music folder
pub async fn update_music_folder(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<UpdateMusicFolderRequest>,
) -> Result<impl IntoResponse> {
    // Check if folder exists
    let existing: Option<MusicFolder> =
        sqlx::query_as("SELECT id, name, path, enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)));
    }

    // Build update query dynamically
    let mut updates = Vec::new();
    let mut values: Vec<String> = Vec::new();

    if let Some(name) = &request.name {
        updates.push("name = ?");
        values.push(name.clone());
    }
    if let Some(enabled) = request.enabled {
        updates.push("enabled = ?");
        values.push(if enabled {
            "1".to_string()
        } else {
            "0".to_string()
        });
    }

    if updates.is_empty() {
        return Ok(StatusCode::OK.into_response());
    }

    let query = format!(
        "UPDATE music_folders SET {} WHERE id = ?",
        updates.join(", ")
    );
    let mut q = sqlx::query(&query);

    for value in &values {
        q = q.bind(value);
    }
    q = q.bind(id);

    q.execute(&state.pool).await?;

    Ok(StatusCode::OK.into_response())
}

/// DELETE /ferrotune/music-folders/{id} - Delete a music folder
pub async fn delete_music_folder(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse> {
    // Check if folder exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)));
    }

    // Delete all songs from this folder (cascade)
    // Songs reference albums and artists, which may become orphaned
    // but we'll leave cleanup for a separate maintenance operation
    sqlx::query("DELETE FROM songs WHERE music_folder_id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    // Delete the folder
    sqlx::query("DELETE FROM music_folders WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/music-folders/{id}/stats - Get detailed stats for a folder
pub async fn get_music_folder_stats(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<MusicFolderStats>> {
    // Check if folder exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)));
    }

    let stats = get_folder_stats(&state.pool, id).await?;
    Ok(Json(stats))
}

/// Helper: Get all music folders with their stats
async fn get_all_music_folders_with_stats(state: &AppState) -> Result<Vec<MusicFolderInfo>> {
    let folders: Vec<MusicFolder> = sqlx::query_as(
        "SELECT id, name, path, enabled, last_scanned_at, scan_error FROM music_folders ORDER BY id"
    )
    .fetch_all(&state.pool)
    .await?;

    let mut result = Vec::with_capacity(folders.len());
    for folder in folders {
        let stats = get_folder_stats(&state.pool, folder.id).await?;
        result.push(MusicFolderInfo {
            id: folder.id,
            name: folder.name,
            path: folder.path,
            enabled: folder.enabled,
            last_scanned_at: folder.last_scanned_at,
            scan_error: folder.scan_error,
            stats,
        });
    }

    Ok(result)
}

/// Helper: Get a single music folder with stats
async fn get_music_folder_with_stats(state: &AppState, id: i64) -> Result<Option<MusicFolderInfo>> {
    let folder: Option<MusicFolder> = sqlx::query_as(
        "SELECT id, name, path, enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;

    match folder {
        Some(folder) => {
            let stats = get_folder_stats(&state.pool, folder.id).await?;
            Ok(Some(MusicFolderInfo {
                id: folder.id,
                name: folder.name,
                path: folder.path,
                enabled: folder.enabled,
                last_scanned_at: folder.last_scanned_at,
                scan_error: folder.scan_error,
                stats,
            }))
        }
        None => Ok(None),
    }
}

/// Helper: Get statistics for a specific folder
async fn get_folder_stats(pool: &sqlx::SqlitePool, folder_id: i64) -> Result<MusicFolderStats> {
    let (song_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM songs WHERE music_folder_id = ?")
            .bind(folder_id)
            .fetch_one(pool)
            .await?;

    let (album_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT album_id) FROM songs WHERE music_folder_id = ? AND album_id IS NOT NULL"
    )
    .bind(folder_id)
    .fetch_one(pool)
    .await?;

    let (artist_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT artist_id) FROM songs WHERE music_folder_id = ? AND artist_id IS NOT NULL"
    )
    .bind(folder_id)
    .fetch_one(pool)
    .await?;

    let (total_duration, total_size): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT SUM(duration), SUM(file_size) FROM songs WHERE music_folder_id = ?")
            .bind(folder_id)
            .fetch_one(pool)
            .await?;

    Ok(MusicFolderStats {
        song_count,
        album_count,
        artist_count,
        total_duration_seconds: total_duration.unwrap_or(0),
        total_size_bytes: total_size.unwrap_or(0),
    })
}

/// Update the last_scanned_at timestamp for a folder after a successful scan.
pub async fn update_folder_scan_timestamp(pool: &sqlx::SqlitePool, folder_id: i64) -> Result<()> {
    sqlx::query("UPDATE music_folders SET last_scanned_at = ?, scan_error = NULL WHERE id = ?")
        .bind(Utc::now())
        .bind(folder_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update the scan_error for a folder after a failed scan.
pub async fn update_folder_scan_error(
    pool: &sqlx::SqlitePool,
    folder_id: i64,
    error: &str,
) -> Result<()> {
    sqlx::query("UPDATE music_folders SET scan_error = ? WHERE id = ?")
        .bind(error)
        .bind(folder_id)
        .execute(pool)
        .await?;
    Ok(())
}
