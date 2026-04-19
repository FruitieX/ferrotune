//! Music folder management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow managing multiple music libraries (music folders).
//! Each music folder can be independently enabled/disabled and scanned.

use crate::api::ferrotune::users::require_admin;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser as AuthenticatedUser;
use crate::api::AppState;
use crate::db::models::MusicFolder;
use crate::db::DatabaseHandle;
use crate::error::{Error, FerrotuneApiResult};
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
    pub watch_enabled: bool,
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
    #[serde(default)]
    pub watch_enabled: bool,
}

/// Request to update a music folder.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateMusicFolderRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub watch_enabled: Option<bool>,
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
) -> FerrotuneApiResult<Json<MusicFoldersResponse>> {
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
) -> FerrotuneApiResult<Json<MusicFolderInfo>> {
    let folder = get_music_folder_with_stats(&state, id).await?;
    match folder {
        Some(f) => Ok(Json(f)),
        None => Err(Error::NotFound(format!("Music folder {} not found", id)).into()),
    }
}

/// POST /ferrotune/music-folders - Create a new music folder
pub async fn create_music_folder(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateMusicFolderRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Validate the path exists
    let path = std::path::Path::new(&request.path);
    if !path.exists() {
        return Err(Error::InvalidRequest(format!("Path does not exist: {}", request.path)).into());
    }
    if !path.is_dir() {
        return Err(
            Error::InvalidRequest(format!("Path is not a directory: {}", request.path)).into(),
        );
    }

    // Check if path is already registered
    let existing: Option<(i64,)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT id FROM music_folders WHERE path = ?")
            .bind(&request.path)
            .fetch_optional(pool)
            .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as("SELECT id FROM music_folders WHERE path = $1")
            .bind(&request.path)
            .fetch_optional(pool)
            .await?
    };

    if existing.is_some() {
        return Err(Error::InvalidRequest(format!(
            "Path is already registered as a music folder: {}",
            request.path
        ))
        .into());
    }

    // Create the folder
    let id = if let Ok(pool) = state.database.sqlite_pool() {
        let result = sqlx::query(
            "INSERT INTO music_folders (name, path, enabled, watch_enabled) VALUES (?, ?, 1, ?)",
        )
        .bind(&request.name)
        .bind(&request.path)
        .bind(request.watch_enabled)
        .execute(pool)
        .await?;
        result.last_insert_rowid()
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_scalar(
            "INSERT INTO music_folders (name, path, enabled, watch_enabled) VALUES ($1, $2, TRUE, $3) RETURNING id",
        )
        .bind(&request.name)
        .bind(&request.path)
        .bind(request.watch_enabled)
        .fetch_one(pool)
        .await?
    };

    // Grant access to the current user for the new music folder
    if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query(
            "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query(
            "INSERT INTO user_library_access (user_id, music_folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(pool)
        .await?;
    }

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<UpdateMusicFolderRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Check if folder exists
    let existing: Option<MusicFolder> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as("SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
    };

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    if let Some(name) = &request.name {
        if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("UPDATE music_folders SET name = ? WHERE id = ?")
                .bind(name)
                .bind(id)
                .execute(pool)
                .await?;
        } else {
            let pool = state.database.postgres_pool()?;
            sqlx::query("UPDATE music_folders SET name = $1 WHERE id = $2")
                .bind(name)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }
    if let Some(enabled) = request.enabled {
        if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("UPDATE music_folders SET enabled = ? WHERE id = ?")
                .bind(enabled)
                .bind(id)
                .execute(pool)
                .await?;
        } else {
            let pool = state.database.postgres_pool()?;
            sqlx::query("UPDATE music_folders SET enabled = $1 WHERE id = $2")
                .bind(enabled)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }
    if let Some(watch_enabled) = request.watch_enabled {
        if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("UPDATE music_folders SET watch_enabled = ? WHERE id = ?")
                .bind(watch_enabled)
                .bind(id)
                .execute(pool)
                .await?;
        } else {
            let pool = state.database.postgres_pool()?;
            sqlx::query("UPDATE music_folders SET watch_enabled = $1 WHERE id = $2")
                .bind(watch_enabled)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }

    Ok(StatusCode::OK.into_response())
}

fn build_in_placeholders(count: usize, postgres: bool) -> String {
    if postgres {
        (1..=count)
            .map(|index| format!("${}", index))
            .collect::<Vec<_>>()
            .join(",")
    } else {
        vec!["?"; count].join(",")
    }
}

async fn execute_bound_string_query(
    database: &(impl DatabaseHandle + ?Sized),
    sqlite_sql: String,
    postgres_sql: String,
    values: &[String],
) -> FerrotuneApiResult<()> {
    if let Ok(pool) = database.sqlite_pool() {
        let mut query = sqlx::query(&sqlite_sql);
        for value in values {
            query = query.bind(value);
        }
        query.execute(pool).await?;
        return Ok(());
    }

    let pool = database.postgres_pool()?;
    let mut query = sqlx::query(&postgres_sql);
    for value in values {
        query = query.bind(value);
    }
    query.execute(pool).await?;
    Ok(())
}

async fn list_string_rows_for_folder(
    database: &(impl DatabaseHandle + ?Sized),
    sqlite_sql: &str,
    postgres_sql: &str,
    folder_id: i64,
) -> FerrotuneApiResult<Vec<String>> {
    let rows: Vec<(String,)> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(sqlite_sql)
            .bind(folder_id)
            .fetch_all(pool)
            .await?
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query_as(postgres_sql)
            .bind(folder_id)
            .fetch_all(pool)
            .await?
    };

    Ok(rows.into_iter().map(|(value,)| value).collect())
}

async fn list_optional_string_rows_for_folder(
    database: &(impl DatabaseHandle + ?Sized),
    sqlite_sql: &str,
    postgres_sql: &str,
    folder_id: i64,
) -> FerrotuneApiResult<Vec<String>> {
    let rows: Vec<(Option<String>,)> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(sqlite_sql)
            .bind(folder_id)
            .fetch_all(pool)
            .await?
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query_as(postgres_sql)
            .bind(folder_id)
            .fetch_all(pool)
            .await?
    };

    Ok(rows.into_iter().filter_map(|(value,)| value).collect())
}

/// DELETE /ferrotune/music-folders/{id} - Delete a music folder
pub async fn delete_music_folder(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Check if folder exists
    let existing: Option<(i64,)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as("SELECT id FROM music_folders WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
    };

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    // Get song IDs being deleted for cleanup
    let song_ids = list_string_rows_for_folder(
        &state.database,
        "SELECT id FROM songs WHERE music_folder_id = ?",
        "SELECT id FROM songs WHERE music_folder_id = $1",
        id,
    )
    .await?;

    // Get album IDs from songs being deleted
    let album_ids = list_optional_string_rows_for_folder(
        &state.database,
        "SELECT DISTINCT album_id FROM songs WHERE music_folder_id = ?",
        "SELECT DISTINCT album_id FROM songs WHERE music_folder_id = $1",
        id,
    )
    .await?;

    // Get artist IDs from songs being deleted
    let artist_ids = list_string_rows_for_folder(
        &state.database,
        "SELECT DISTINCT artist_id FROM songs WHERE music_folder_id = ?",
        "SELECT DISTINCT artist_id FROM songs WHERE music_folder_id = $1",
        id,
    )
    .await?;

    if !song_ids.is_empty() {
        let sqlite_placeholders = build_in_placeholders(song_ids.len(), false);
        let postgres_placeholders = build_in_placeholders(song_ids.len(), true);

        for (sqlite_sql, postgres_sql) in [
            (
                format!(
                    "DELETE FROM scrobbles WHERE song_id IN ({})",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM scrobbles WHERE song_id IN ({})",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM listening_sessions WHERE song_id IN ({})",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM listening_sessions WHERE song_id IN ({})",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM ratings WHERE item_type = 'song' AND item_id IN ({})",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM ratings WHERE item_type = 'song' AND item_id IN ({})",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM shuffle_excludes WHERE song_id IN ({})",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM shuffle_excludes WHERE song_id IN ({})",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM play_queue_entries WHERE song_id IN ({})",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM play_queue_entries WHERE song_id IN ({})",
                    postgres_placeholders
                ),
            ),
        ] {
            execute_bound_string_query(&state.database, sqlite_sql, postgres_sql, &song_ids)
                .await?;
        }

        for song_id in &song_ids {
            crate::db::queries::delete_song(&state.database, song_id)
                .await
                .map_err(|e| {
                    Error::Internal(format!("Failed to delete song {}: {}", song_id, e))
                })?;
        }
    }

    // Clean up orphaned albums (albums with no remaining songs)
    if !album_ids.is_empty() {
        let sqlite_placeholders = build_in_placeholders(album_ids.len(), false);
        let postgres_placeholders = build_in_placeholders(album_ids.len(), true);

        for (sqlite_sql, postgres_sql) in [
            (
                format!(
                    "DELETE FROM starred WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM starred WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM ratings WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM ratings WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM albums WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM albums WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
                    postgres_placeholders
                ),
            ),
        ] {
            execute_bound_string_query(&state.database, sqlite_sql, postgres_sql, &album_ids)
                .await?;
        }
    }

    // Clean up orphaned artists (artists with no remaining songs)
    if !artist_ids.is_empty() {
        let sqlite_placeholders = build_in_placeholders(artist_ids.len(), false);
        let postgres_placeholders = build_in_placeholders(artist_ids.len(), true);

        for (sqlite_sql, postgres_sql) in [
            (
                format!(
                    "DELETE FROM starred WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM starred WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM ratings WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM ratings WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    postgres_placeholders
                ),
            ),
            (
                format!(
                    "DELETE FROM artists WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    sqlite_placeholders
                ),
                format!(
                    "DELETE FROM artists WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT artist_id FROM songs)",
                    postgres_placeholders
                ),
            ),
        ] {
            execute_bound_string_query(&state.database, sqlite_sql, postgres_sql, &artist_ids)
                .await?;
        }
    }

    // Delete user library access for this folder
    if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query("DELETE FROM user_library_access WHERE music_folder_id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query("DELETE FROM user_library_access WHERE music_folder_id = $1")
            .bind(id)
            .execute(pool)
            .await?;
    }

    // Delete the folder
    if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query("DELETE FROM music_folders WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query("DELETE FROM music_folders WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/music-folders/{id}/stats - Get detailed stats for a folder
pub async fn get_music_folder_stats(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<Json<MusicFolderStats>> {
    // Check if folder exists
    let existing: Option<(i64,)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as("SELECT id FROM music_folders WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
    };

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    let stats = get_folder_stats(&state.database, id).await?;
    Ok(Json(stats))
}

/// Helper: Get all music folders with their stats
async fn get_all_music_folders_with_stats(
    state: &AppState,
) -> FerrotuneApiResult<Vec<MusicFolderInfo>> {
    let folders: Vec<MusicFolder> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as(
            "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders ORDER BY id"
        )
        .fetch_all(pool)
        .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as(
            "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders ORDER BY id"
        )
        .fetch_all(pool)
        .await?
    };

    let mut result = Vec::with_capacity(folders.len());
    for folder in folders {
        let stats = get_folder_stats(&state.database, folder.id).await?;
        result.push(MusicFolderInfo {
            id: folder.id,
            name: folder.name,
            path: folder.path,
            enabled: folder.enabled,
            watch_enabled: folder.watch_enabled,
            last_scanned_at: folder.last_scanned_at,
            scan_error: folder.scan_error,
            stats,
        });
    }

    Ok(result)
}

/// Helper: Get a single music folder with stats
async fn get_music_folder_with_stats(
    state: &AppState,
    id: i64,
) -> FerrotuneApiResult<Option<MusicFolderInfo>> {
    let folder: Option<MusicFolder> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as(
            "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else {
        let pool = state.database.postgres_pool()?;
        sqlx::query_as(
            "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    };

    match folder {
        Some(folder) => {
            let stats = get_folder_stats(&state.database, folder.id).await?;
            Ok(Some(MusicFolderInfo {
                id: folder.id,
                name: folder.name,
                path: folder.path,
                enabled: folder.enabled,
                watch_enabled: folder.watch_enabled,
                last_scanned_at: folder.last_scanned_at,
                scan_error: folder.scan_error,
                stats,
            }))
        }
        None => Ok(None),
    }
}

/// Helper: Get statistics for a specific folder
async fn get_folder_stats(
    database: &(impl DatabaseHandle + ?Sized),
    folder_id: i64,
) -> FerrotuneApiResult<MusicFolderStats> {
    if let Ok(pool) = database.sqlite_pool() {
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
        let (total_duration, total_size): (Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT SUM(duration), SUM(file_size) FROM songs WHERE music_folder_id = ?",
        )
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
    } else {
        let pool = database.postgres_pool()?;
        let (song_count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM songs WHERE music_folder_id = $1")
                .bind(folder_id)
                .fetch_one(pool)
                .await?;
        let (album_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT album_id) FROM songs WHERE music_folder_id = $1 AND album_id IS NOT NULL"
        )
        .bind(folder_id)
        .fetch_one(pool)
        .await?;
        let (artist_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT artist_id) FROM songs WHERE music_folder_id = $1 AND artist_id IS NOT NULL"
        )
        .bind(folder_id)
        .fetch_one(pool)
        .await?;
        let (total_duration, total_size): (Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT SUM(duration)::BIGINT, SUM(file_size)::BIGINT FROM songs WHERE music_folder_id = $1",
        )
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
}

/// Update the last_scanned_at timestamp for a folder after a successful scan.
pub async fn update_folder_scan_timestamp(
    database: &(impl DatabaseHandle + ?Sized),
    folder_id: i64,
) -> FerrotuneApiResult<()> {
    if let Ok(pool) = database.sqlite_pool() {
        sqlx::query("UPDATE music_folders SET last_scanned_at = ?, scan_error = NULL WHERE id = ?")
            .bind(Utc::now())
            .bind(folder_id)
            .execute(pool)
            .await?;
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query(
            "UPDATE music_folders SET last_scanned_at = $1, scan_error = NULL WHERE id = $2",
        )
        .bind(Utc::now())
        .bind(folder_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Update the scan_error for a folder after a failed scan.
pub async fn update_folder_scan_error(
    database: &(impl DatabaseHandle + ?Sized),
    folder_id: i64,
    error: &str,
) -> FerrotuneApiResult<()> {
    if let Ok(pool) = database.sqlite_pool() {
        sqlx::query("UPDATE music_folders SET scan_error = ? WHERE id = ?")
            .bind(error)
            .bind(folder_id)
            .execute(pool)
            .await?;
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query("UPDATE music_folders SET scan_error = $1 WHERE id = $2")
            .bind(error)
            .bind(folder_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}
