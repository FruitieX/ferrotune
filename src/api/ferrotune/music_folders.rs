//! Music folder management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow managing multiple music libraries (music folders).
//! Each music folder can be independently enabled/disabled and scanned.

use crate::api::ferrotune::users::require_admin;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser as AuthenticatedUser;
use crate::api::AppState;
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
    let existing =
        crate::db::repo::music_folders::id_by_path(&state.database, &request.path).await?;

    if existing.is_some() {
        return Err(Error::InvalidRequest(format!(
            "Path is already registered as a music folder: {}",
            request.path
        ))
        .into());
    }

    // Create the folder
    let id = crate::db::repo::music_folders::create(
        &state.database,
        &request.name,
        &request.path,
        request.watch_enabled,
    )
    .await?;

    // Grant access to the current user for the new music folder
    crate::db::repo::music_folders::grant_user_access(&state.database, user.user_id, id).await?;

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
    let existing = crate::db::repo::music_folders::find_by_id(&state.database, id).await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    if let Some(name) = &request.name {
        crate::db::repo::music_folders::update_name(&state.database, id, name).await?;
    }
    if let Some(enabled) = request.enabled {
        crate::db::repo::music_folders::update_enabled(&state.database, id, enabled).await?;
    }
    if let Some(watch_enabled) = request.watch_enabled {
        crate::db::repo::music_folders::update_watch_enabled(&state.database, id, watch_enabled)
            .await?;
    }

    Ok(StatusCode::OK.into_response())
}

/// DELETE /ferrotune/music-folders/{id} - Delete a music folder
pub async fn delete_music_folder(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Check if folder exists
    if !crate::db::repo::music_folders::exists_by_id(&state.database, id).await? {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    // Get song / album / artist IDs that will need cleanup after the folder
    // (and its songs) go away.
    let song_ids =
        crate::db::repo::music_folders::list_song_ids_for_folder(&state.database, id).await?;
    let album_ids =
        crate::db::repo::music_folders::list_distinct_album_ids_for_folder(&state.database, id)
            .await?;
    let artist_ids =
        crate::db::repo::music_folders::list_distinct_artist_ids_for_folder(&state.database, id)
            .await?;

    if !song_ids.is_empty() {
        crate::db::repo::music_folders::delete_scrobbles_for_songs(&state.database, &song_ids)
            .await?;
        crate::db::repo::music_folders::delete_listening_sessions_for_songs(
            &state.database,
            &song_ids,
        )
        .await?;
        crate::db::repo::music_folders::delete_ratings_for_item_type(
            &state.database,
            "song",
            &song_ids,
        )
        .await?;
        crate::db::repo::music_folders::delete_shuffle_excludes_for_songs(
            &state.database,
            &song_ids,
        )
        .await?;
        crate::db::repo::music_folders::delete_play_queue_entries_for_songs(
            &state.database,
            &song_ids,
        )
        .await?;

        for song_id in &song_ids {
            crate::db::queries::delete_song(&state.database, song_id)
                .await
                .map_err(|e| {
                    Error::Internal(format!("Failed to delete song {}: {}", song_id, e))
                })?;
        }
    }

    // Clean up orphaned albums / artists (plus their starred+ratings rows).
    crate::db::repo::music_folders::cleanup_orphan_album_related(&state.database, &album_ids)
        .await?;
    crate::db::repo::music_folders::cleanup_orphan_artist_related(&state.database, &artist_ids)
        .await?;

    // Delete user library access for this folder, then the folder itself.
    crate::db::repo::music_folders::delete_user_access_for_folder(&state.database, id).await?;
    crate::db::repo::music_folders::delete_by_id(&state.database, id).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/music-folders/{id}/stats - Get detailed stats for a folder
pub async fn get_music_folder_stats(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<Json<MusicFolderStats>> {
    // Check if folder exists
    if !crate::db::repo::music_folders::exists_by_id(&state.database, id).await? {
        return Err(Error::NotFound(format!("Music folder {} not found", id)).into());
    }

    let stats = get_folder_stats(&state.database, id).await?;
    Ok(Json(stats))
}

/// Helper: Get all music folders with their stats
async fn get_all_music_folders_with_stats(
    state: &AppState,
) -> FerrotuneApiResult<Vec<MusicFolderInfo>> {
    let folders = crate::db::repo::music_folders::list_all_ordered_by_id(&state.database).await?;

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
    let folder = crate::db::repo::music_folders::find_by_id(&state.database, id).await?;

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
    database: &crate::db::Database,
    folder_id: i64,
) -> FerrotuneApiResult<MusicFolderStats> {
    let song_count = crate::db::repo::music_folders::count_songs(database, folder_id).await?;
    let album_count =
        crate::db::repo::music_folders::count_distinct_albums(database, folder_id).await?;
    let artist_count =
        crate::db::repo::music_folders::count_distinct_artists(database, folder_id).await?;
    let sums = crate::db::repo::music_folders::sum_duration_and_size(database, folder_id).await?;

    Ok(MusicFolderStats {
        song_count,
        album_count,
        artist_count,
        total_duration_seconds: sums.total_duration.unwrap_or(0),
        total_size_bytes: sums.total_size.unwrap_or(0),
    })
}

/// Update the last_scanned_at timestamp for a folder after a successful scan.
pub async fn update_folder_scan_timestamp(
    database: &crate::db::Database,
    folder_id: i64,
) -> FerrotuneApiResult<()> {
    crate::db::repo::music_folders::set_scan_success(database, folder_id).await?;
    Ok(())
}

/// Update the scan_error for a folder after a failed scan.
pub async fn update_folder_scan_error(
    database: &crate::db::Database,
    folder_id: i64,
    error: &str,
) -> FerrotuneApiResult<()> {
    crate::db::repo::music_folders::set_scan_error(database, folder_id, error).await?;
    Ok(())
}
