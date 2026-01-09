//! Music folder management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow managing multiple music libraries (music folders).
//! Each music folder can be independently enabled/disabled and scanned.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::models::MusicFolder;
use crate::error::{Error, FerrotuneApiResult, Result};
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
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE path = ?")
        .bind(&request.path)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(Error::InvalidRequest(format!(
            "Path is already registered as a music folder: {}",
            request.path
        ))
        .into());
    }

    // Create the folder
    let result = sqlx::query(
        "INSERT INTO music_folders (name, path, enabled, watch_enabled) VALUES (?, ?, 1, ?)",
    )
    .bind(&request.name)
    .bind(&request.path)
    .bind(request.watch_enabled)
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
) -> FerrotuneApiResult<impl IntoResponse> {
    // Check if folder exists
    let existing: Option<MusicFolder> =
        sqlx::query_as("SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
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
    if let Some(watch_enabled) = request.watch_enabled {
        updates.push("watch_enabled = ?");
        values.push(if watch_enabled {
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
) -> FerrotuneApiResult<impl IntoResponse> {
    // Check if folder exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    // Get song IDs being deleted for cleanup
    let song_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM songs WHERE music_folder_id = ?")
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
    let song_ids: Vec<String> = song_ids.into_iter().map(|(id,)| id).collect();

    // Get album IDs from songs being deleted
    let album_ids: Vec<(Option<String>,)> =
        sqlx::query_as("SELECT DISTINCT album_id FROM songs WHERE music_folder_id = ?")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;
    let album_ids: Vec<String> = album_ids.into_iter().filter_map(|(id,)| id).collect();

    // Get artist IDs from songs being deleted
    let artist_ids: Vec<(String,)> =
        sqlx::query_as("SELECT DISTINCT artist_id FROM songs WHERE music_folder_id = ?")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;
    let artist_ids: Vec<String> = artist_ids.into_iter().map(|(id,)| id).collect();

    // Delete play history (scrobbles) for songs in this folder
    if !song_ids.is_empty() {
        let placeholders = song_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!("DELETE FROM scrobbles WHERE song_id IN ({})", placeholders);
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Delete listening sessions
        let query = format!(
            "DELETE FROM listening_sessions WHERE song_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Delete starred items for songs
        let query = format!(
            "DELETE FROM starred WHERE item_type = 'song' AND item_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Delete ratings for songs
        let query = format!(
            "DELETE FROM ratings WHERE item_type = 'song' AND item_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Delete shuffle excludes
        let query = format!(
            "DELETE FROM shuffle_excludes WHERE song_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Delete play queue entries
        let query = format!(
            "DELETE FROM play_queue_entries WHERE song_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        q.execute(&state.pool).await?;

        // Convert playlist entries to "missing" entries instead of deleting them.
        // This preserves the song info so entries can be re-matched if the library is re-scanned.
        // Helper struct for song metadata (to avoid complex tuple type)
        #[derive(sqlx::FromRow)]
        struct SongMeta {
            id: String,
            title: String,
            artist_name: Option<String>,
            album_name: Option<String>,
            duration: i64,
        }

        // First, get song metadata for all songs being deleted
        let song_metadata: Vec<SongMeta> = sqlx::query_as(
            "SELECT s.id, s.title, ar.name as artist_name, al.name as album_name, s.duration
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             WHERE s.music_folder_id = ?",
        )
        .bind(id)
        .fetch_all(&state.pool)
        .await?;

        // Build a map of song_id -> metadata for quick lookup
        let song_info: std::collections::HashMap<String, SongMeta> = song_metadata
            .into_iter()
            .map(|meta| (meta.id.clone(), meta))
            .collect();

        // Get all playlist entries referencing these songs
        let playlist_entries_query = format!(
            "SELECT playlist_id, position, song_id FROM playlist_songs WHERE song_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, (String, i64, Option<String>)>(&playlist_entries_query);
        for song_id in &song_ids {
            q = q.bind(song_id);
        }
        let playlist_entries: Vec<(String, i64, Option<String>)> = q.fetch_all(&state.pool).await?;

        // Collect unique playlist IDs for updating totals later
        let mut affected_playlist_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        // Update each playlist entry to be a missing entry
        for (playlist_id, position, song_id_opt) in &playlist_entries {
            if let Some(song_id) = song_id_opt {
                if let Some(meta) = song_info.get(song_id) {
                    // Build the missing entry data JSON
                    let missing_data = serde_json::json!({
                        "title": meta.title,
                        "artist": meta.artist_name,
                        "album": meta.album_name,
                        "duration": meta.duration as i32,
                        "raw": format!("{} - {}", meta.artist_name.as_deref().unwrap_or("Unknown Artist"), meta.title)
                    });
                    let missing_json = serde_json::to_string(&missing_data).unwrap_or_default();

                    // Build search text: "artist - album - title" for filtering
                    let mut parts = Vec::new();
                    if let Some(a) = &meta.artist_name {
                        parts.push(a.as_str());
                    }
                    if let Some(al) = &meta.album_name {
                        parts.push(al.as_str());
                    }
                    parts.push(meta.title.as_str());
                    let search_text = parts.join(" - ");

                    // Update the entry to be missing
                    sqlx::query(
                        "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = ?, missing_search_text = ? WHERE playlist_id = ? AND position = ?"
                    )
                    .bind(&missing_json)
                    .bind(&search_text)
                    .bind(playlist_id)
                    .bind(position)
                    .execute(&state.pool)
                    .await?;

                    affected_playlist_ids.insert(playlist_id.clone());
                }
            }
        }

        // Update totals for all affected playlists
        for playlist_id in &affected_playlist_ids {
            sqlx::query(
                "UPDATE playlists SET
                    song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ? AND song_id IS NOT NULL),
                    duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s
                                INNER JOIN playlist_songs ps ON s.id = ps.song_id
                                WHERE ps.playlist_id = ?),
                    updated_at = datetime('now')
                WHERE id = ?"
            )
            .bind(playlist_id)
            .bind(playlist_id)
            .bind(playlist_id)
            .execute(&state.pool)
            .await?;
        }
    }

    // Delete all songs from this folder
    sqlx::query("DELETE FROM songs WHERE music_folder_id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    // Clean up orphaned albums (albums with no remaining songs)
    if !album_ids.is_empty() {
        let placeholders = album_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        // Delete starred items for orphaned albums
        let query = format!(
            "DELETE FROM starred WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for album_id in &album_ids {
            q = q.bind(album_id);
        }
        q.execute(&state.pool).await?;

        // Delete ratings for orphaned albums
        let query = format!(
            "DELETE FROM ratings WHERE item_type = 'album' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for album_id in &album_ids {
            q = q.bind(album_id);
        }
        q.execute(&state.pool).await?;

        // Delete orphaned albums
        let query = format!(
            "DELETE FROM albums WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for album_id in &album_ids {
            q = q.bind(album_id);
        }
        q.execute(&state.pool).await?;
    }

    // Clean up orphaned artists (artists with no remaining songs)
    if !artist_ids.is_empty() {
        let placeholders = artist_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        // Delete starred items for orphaned artists
        let query = format!(
            "DELETE FROM starred WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for artist_id in &artist_ids {
            q = q.bind(artist_id);
        }
        q.execute(&state.pool).await?;

        // Delete ratings for orphaned artists
        let query = format!(
            "DELETE FROM ratings WHERE item_type = 'artist' AND item_id IN ({}) AND item_id NOT IN (SELECT DISTINCT artist_id FROM songs)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for artist_id in &artist_ids {
            q = q.bind(artist_id);
        }
        q.execute(&state.pool).await?;

        // Delete orphaned artists
        let query = format!(
            "DELETE FROM artists WHERE id IN ({}) AND id NOT IN (SELECT DISTINCT artist_id FROM songs)",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for artist_id in &artist_ids {
            q = q.bind(artist_id);
        }
        q.execute(&state.pool).await?;
    }

    // Delete user library access for this folder
    sqlx::query("DELETE FROM user_library_access WHERE music_folder_id = ?")
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
) -> FerrotuneApiResult<Json<MusicFolderStats>> {
    // Check if folder exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM music_folders WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    let stats = get_folder_stats(&state.pool, id).await?;
    Ok(Json(stats))
}

/// Helper: Get all music folders with their stats
async fn get_all_music_folders_with_stats(state: &AppState) -> Result<Vec<MusicFolderInfo>> {
    let folders: Vec<MusicFolder> = sqlx::query_as(
        "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders ORDER BY id"
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
            watch_enabled: folder.watch_enabled,
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
        "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error FROM music_folders WHERE id = ?"
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
