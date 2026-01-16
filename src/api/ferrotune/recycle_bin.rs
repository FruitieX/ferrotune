//! Recycle bin / soft delete API endpoints.
//!
//! This module provides endpoints for managing songs marked for deletion.
//! Instead of immediately deleting files, songs are "marked for deletion"
//! and moved to a recycle bin. After 30 days (or manual confirmation),
//! the files are permanently deleted.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Request to mark songs for deletion
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MarkForDeletionRequest {
    /// List of song IDs to mark for deletion
    pub song_ids: Vec<String>,
}

/// Response after marking songs for deletion
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MarkForDeletionResponse {
    pub success: bool,
    pub marked_count: i32,
    pub message: String,
}

/// Request to restore songs from recycle bin
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RestoreSongsRequest {
    /// List of song IDs to restore
    pub song_ids: Vec<String>,
}

/// Response after restoring songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RestoreSongsResponse {
    pub success: bool,
    pub restored_count: i32,
    pub message: String,
}

/// Song in the recycle bin
#[derive(Serialize, TS, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RecycleBinSong {
    pub id: String,
    pub title: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    #[ts(type = "number")]
    pub duration: i64,
    pub file_path: String,
    #[ts(type = "number")]
    pub file_size: i64,
    pub cover_art_hash: Option<String>,
    pub marked_for_deletion_at: DateTime<Utc>,
    /// Days remaining before auto-deletion
    #[sqlx(skip)]
    #[ts(type = "number")]
    pub days_remaining: i32,
}

/// Query params for recycle bin list
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RecycleBinParams {
    /// Optional offset for pagination
    #[ts(type = "number | undefined")]
    pub offset: Option<i64>,
    /// Optional limit for pagination (default: 100)
    #[ts(type = "number | undefined")]
    pub limit: Option<i64>,
}

/// Response listing songs in recycle bin
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RecycleBinResponse {
    pub songs: Vec<RecycleBinSong>,
    #[ts(type = "number")]
    pub total_count: i64,
}

/// Response after permanently deleting songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PermanentDeleteResponse {
    pub success: bool,
    pub deleted_count: i32,
    pub message: String,
    /// List of errors if any files failed to delete
    pub errors: Vec<String>,
}

/// Request to permanently delete specific songs
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PermanentDeleteRequest {
    /// List of song IDs to permanently delete
    pub song_ids: Vec<String>,
}

const RETENTION_DAYS: i64 = 30;

/// Mark songs for deletion (soft delete)
/// POST /ferrotune/recycle-bin/mark
pub async fn mark_for_deletion(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<MarkForDeletionRequest>,
) -> FerrotuneApiResult<Json<MarkForDeletionResponse>> {
    if request.song_ids.is_empty() {
        return Err(Error::InvalidRequest("No song IDs provided".to_string()).into());
    }

    let now = Utc::now();
    let mut marked_count = 0;

    for song_id in &request.song_ids {
        let result = sqlx::query(
            "UPDATE songs SET marked_for_deletion_at = ? WHERE id = ? AND marked_for_deletion_at IS NULL",
        )
        .bind(now)
        .bind(song_id)
        .execute(&state.pool)
        .await;

        if let Ok(r) = result {
            if r.rows_affected() > 0 {
                marked_count += 1;
            }
        }
    }

    Ok(Json(MarkForDeletionResponse {
        success: true,
        marked_count,
        message: format!(
            "Marked {} song{} for deletion",
            marked_count,
            if marked_count == 1 { "" } else { "s" }
        ),
    }))
}

/// Restore songs from recycle bin
/// POST /ferrotune/recycle-bin/restore
pub async fn restore_songs(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RestoreSongsRequest>,
) -> FerrotuneApiResult<Json<RestoreSongsResponse>> {
    if request.song_ids.is_empty() {
        return Err(Error::InvalidRequest("No song IDs provided".to_string()).into());
    }

    let mut restored_count = 0;

    for song_id in &request.song_ids {
        let result = sqlx::query(
            "UPDATE songs SET marked_for_deletion_at = NULL WHERE id = ? AND marked_for_deletion_at IS NOT NULL",
        )
        .bind(song_id)
        .execute(&state.pool)
        .await;

        if let Ok(r) = result {
            if r.rows_affected() > 0 {
                restored_count += 1;
            }
        }
    }

    Ok(Json(RestoreSongsResponse {
        success: true,
        restored_count,
        message: format!(
            "Restored {} song{}",
            restored_count,
            if restored_count == 1 { "" } else { "s" }
        ),
    }))
}

/// List songs in recycle bin
/// GET /ferrotune/recycle-bin
pub async fn list_recycle_bin(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<RecycleBinParams>,
) -> FerrotuneApiResult<Json<RecycleBinResponse>> {
    let limit = params.limit.unwrap_or(100).min(500);
    let offset = params.offset.unwrap_or(0);

    // Get total count
    let total_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM songs WHERE marked_for_deletion_at IS NOT NULL")
            .fetch_one(&state.pool)
            .await?;

    // Get songs
    let songs: Vec<RecycleBinSong> = sqlx::query_as(
        "SELECT s.id, s.title, ar.name as artist_name, al.name as album_name, \
         s.duration, s.file_path, s.file_size, s.cover_art_hash, s.marked_for_deletion_at \
         FROM songs s \
         INNER JOIN artists ar ON s.artist_id = ar.id \
         LEFT JOIN albums al ON s.album_id = al.id \
         WHERE s.marked_for_deletion_at IS NOT NULL \
         ORDER BY s.marked_for_deletion_at DESC \
         LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // Calculate days remaining for each song
    let now = Utc::now();
    let songs_with_days: Vec<RecycleBinSong> = songs
        .into_iter()
        .map(|mut song| {
            let deletion_date = song.marked_for_deletion_at + Duration::days(RETENTION_DAYS);
            let remaining = (deletion_date - now).num_days();
            song.days_remaining = remaining.max(0) as i32;
            song
        })
        .collect();

    Ok(Json(RecycleBinResponse {
        songs: songs_with_days,
        total_count: total_count.0,
    }))
}

/// Internal helper to delete songs - returns the response data
async fn delete_songs_internal(
    state: &AppState,
    song_ids: &[String],
    require_marked: bool,
) -> PermanentDeleteResponse {
    let mut deleted_count = 0;
    let mut errors: Vec<String> = Vec::new();

    for song_id in song_ids {
        // Get song info including path
        let song_with_folder: Option<(String, String, Option<DateTime<Utc>>)> =
            match sqlx::query_as(
                "SELECT s.file_path, mf.path as folder_path, s.marked_for_deletion_at \
             FROM songs s \
             JOIN music_folders mf ON s.music_folder_id = mf.id \
             WHERE s.id = ?",
            )
            .bind(song_id)
            .fetch_optional(&state.pool)
            .await
            {
                Ok(result) => result,
                Err(e) => {
                    errors.push(format!("Error finding song {}: {}", song_id, e));
                    continue;
                }
            };

        let (file_path, folder_path, marked_at) = match song_with_folder {
            Some(paths) => paths,
            None => {
                errors.push(format!("Song not found: {}", song_id));
                continue;
            }
        };

        // Only delete if it's in the recycle bin (when required)
        if require_marked && marked_at.is_none() {
            errors.push(format!(
                "Song {} is not in recycle bin - mark it for deletion first",
                song_id
            ));
            continue;
        }

        // Construct full path and delete file
        let full_path = std::path::PathBuf::from(&folder_path).join(&file_path);

        if full_path.exists() {
            if let Err(e) = std::fs::remove_file(&full_path) {
                errors.push(format!("Failed to delete file {:?}: {}", full_path, e));
                continue;
            }
        }

        // Delete from database
        match crate::db::queries::delete_song(&state.pool, song_id).await {
            Ok(true) => {
                deleted_count += 1;
            }
            Ok(false) => {
                errors.push(format!("Failed to delete song from database: {}", song_id));
            }
            Err(e) => {
                errors.push(format!("Database error deleting {}: {}", song_id, e));
            }
        }
    }

    let message = if errors.is_empty() {
        format!(
            "Permanently deleted {} file{}",
            deleted_count,
            if deleted_count == 1 { "" } else { "s" }
        )
    } else {
        format!(
            "Deleted {} file{}, {} error{}",
            deleted_count,
            if deleted_count == 1 { "" } else { "s" },
            errors.len(),
            if errors.len() == 1 { "" } else { "s" }
        )
    };

    PermanentDeleteResponse {
        success: errors.is_empty(),
        deleted_count,
        message,
        errors,
    }
}

/// Permanently delete songs (from database and disk)
/// POST /ferrotune/recycle-bin/delete-permanently
pub async fn delete_permanently(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<PermanentDeleteRequest>,
) -> FerrotuneApiResult<Json<PermanentDeleteResponse>> {
    // Check if file deletion is enabled
    if !super::server_config::is_file_deletion_enabled(&state).await {
        return Err(Error::Forbidden(
            "File deletion is disabled. Enable 'Allow file deletion' in server settings."
                .to_string(),
        )
        .into());
    }

    if request.song_ids.is_empty() {
        return Err(Error::InvalidRequest("No song IDs provided".to_string()).into());
    }

    let response = delete_songs_internal(&state, &request.song_ids, true).await;
    Ok(Json(response))
}

/// Empty the recycle bin - delete all songs marked for deletion
/// POST /ferrotune/recycle-bin/empty
pub async fn empty_recycle_bin(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<PermanentDeleteResponse>> {
    // Check if file deletion is enabled
    if !super::server_config::is_file_deletion_enabled(&state).await {
        return Err(Error::Forbidden(
            "File deletion is disabled. Enable 'Allow file deletion' in server settings."
                .to_string(),
        )
        .into());
    }

    // Get all songs in recycle bin
    let song_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM songs WHERE marked_for_deletion_at IS NOT NULL")
            .fetch_all(&state.pool)
            .await?;

    if song_ids.is_empty() {
        return Ok(Json(PermanentDeleteResponse {
            success: true,
            deleted_count: 0,
            message: "Recycle bin is already empty".to_string(),
            errors: vec![],
        }));
    }

    let ids: Vec<String> = song_ids.into_iter().map(|(id,)| id).collect();
    let response = delete_songs_internal(&state, &ids, true).await;
    Ok(Json(response))
}

/// Purge expired songs (older than 30 days) - called periodically or on startup
/// POST /ferrotune/recycle-bin/purge-expired
pub async fn purge_expired(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<PermanentDeleteResponse>> {
    // Check if file deletion is enabled
    if !super::server_config::is_file_deletion_enabled(&state).await {
        return Err(Error::Forbidden(
            "File deletion is disabled. Enable 'Allow file deletion' in server settings."
                .to_string(),
        )
        .into());
    }

    let cutoff = Utc::now() - Duration::days(RETENTION_DAYS);

    // Get all expired songs
    let song_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM songs WHERE marked_for_deletion_at IS NOT NULL AND marked_for_deletion_at < ?",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;

    if song_ids.is_empty() {
        return Ok(Json(PermanentDeleteResponse {
            success: true,
            deleted_count: 0,
            message: "No expired songs to purge".to_string(),
            errors: vec![],
        }));
    }

    tracing::info!("Purging {} expired songs from recycle bin", song_ids.len());

    let ids: Vec<String> = song_ids.into_iter().map(|(id,)| id).collect();
    let response = delete_songs_internal(&state, &ids, true).await;
    Ok(Json(response))
}
