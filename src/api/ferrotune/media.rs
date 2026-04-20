//! Media management endpoints for the Admin API.

use crate::api::common::search::{search_songs_for_queue, SearchParams};
use crate::api::ferrotune::users::require_admin;
use crate::api::subsonic::auth::{AuthenticatedUser, FerrotuneAuthenticatedUser};
use crate::api::subsonic::xml::ResponseFormat;
use crate::api::AppState;
use crate::db::queries;
use crate::db::repo;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Response,
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteSongResponse {
    success: bool,
    message: String,
}

/// Delete a song from the database (not from disk).
///
/// DELETE /ferrotune/songs/:id
///
/// This removes the song from the database, including all related data:
/// - Playlist entries
/// - Scrobble history
/// - Starred/favorite status
/// - Full-text search index
///
/// Note: This does NOT delete the actual file from disk. On the next scan,
/// the song will be re-added to the database unless the file is also removed.
pub async fn delete_song(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<DeleteSongResponse>> {
    require_admin(&user)?;

    // First verify the song exists
    let song = repo::browse::get_song_by_id(&state.database, &id)
        .await
        .map_err(|e| Error::Internal(format!("Database error: {}", e)))?
        .ok_or_else(|| Error::NotFound(format!("Song not found: {}", id)))?;

    // Delete the song
    let deleted = queries::delete_song(&state.database, &id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to delete song: {}", e)))?;

    if deleted {
        Ok(Json(DeleteSongResponse {
            success: true,
            message: format!("Successfully deleted song: {}", song.title),
        }))
    } else {
        Err(FerrotuneApiError::from(Error::NotFound(
            "Song not found or already deleted".to_string(),
        )))
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteSongFileResponse {
    success: bool,
    deleted_count: i32,
    message: String,
}

/// Request body for deleting song files
#[derive(serde::Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteSongFilesRequest {
    /// List of song IDs to delete
    pub song_ids: Vec<String>,
}

/// Delete songs from both the database AND the file system.
///
/// POST /ferrotune/songs/delete-files
///
/// This is a destructive operation that:
/// 1. Deletes the actual audio files from disk
/// 2. Removes the songs from the database
///
/// Requires `allow_file_deletion = true` in server config.
pub async fn delete_song_files(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<DeleteSongFilesRequest>,
) -> FerrotuneApiResult<Json<DeleteSongFileResponse>> {
    require_admin(&user)?;

    // Check if file deletion is enabled
    if !super::server_config::is_file_deletion_enabled(&state).await {
        return Err(FerrotuneApiError::from(Error::Forbidden(
            "File deletion is disabled. Enable 'Allow file deletion' in server settings."
                .to_string(),
        )));
    }

    if request.song_ids.is_empty() {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "No song IDs provided".to_string(),
        )));
    }

    let mut deleted_count = 0;
    let mut errors: Vec<String> = Vec::new();

    for song_id in &request.song_ids {
        // Get the song and its folder path to construct the full file path
        #[derive(sea_orm::FromQueryResult)]
        struct SongPathRow {
            file_path: String,
            folder_path: String,
        }
        let result = crate::db::raw::query_one::<SongPathRow>(
            state.database.conn(),
            "SELECT s.file_path, mf.path as folder_path \
             FROM songs s \
             JOIN music_folders mf ON s.music_folder_id = mf.id \
             WHERE s.id = ?",
            "SELECT s.file_path, mf.path as folder_path \
             FROM songs s \
             JOIN music_folders mf ON s.music_folder_id = mf.id \
             WHERE s.id = $1",
            [sea_orm::Value::from(song_id.clone())],
        )
        .await;
        let song_with_folder = match result {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Error finding song {}: {}", song_id, e));
                continue;
            }
        };

        let (file_path, folder_path) = match song_with_folder {
            Some(SongPathRow {
                file_path,
                folder_path,
            }) => (file_path, folder_path),
            None => {
                errors.push(format!("Song not found: {}", song_id));
                continue;
            }
        };

        // Construct full path
        let full_path = std::path::PathBuf::from(&folder_path).join(&file_path);

        // Try to delete the file from disk
        if full_path.exists() {
            if let Err(e) = std::fs::remove_file(&full_path) {
                errors.push(format!("Failed to delete file {:?}: {}", full_path, e));
                continue;
            }
        }

        // Delete from database
        match queries::delete_song(&state.database, song_id).await {
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
            "Successfully deleted {} file{}",
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

    if !errors.is_empty() {
        tracing::warn!("File deletion errors: {:?}", errors);
    }

    Ok(Json(DeleteSongFileResponse {
        success: errors.is_empty(),
        deleted_count,
        message,
    }))
}

/// Response for getting song IDs matching a search/filter query.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongIdsResponse {
    /// List of song IDs matching the query
    pub ids: Vec<String>,
    /// Total count of matching songs
    #[ts(type = "number")]
    pub total: i64,
}

/// Get all song IDs matching the given search and filter criteria.
///
/// GET /ferrotune/songs/ids?query=...&minYear=...&genre=...
pub async fn get_song_ids(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> FerrotuneApiResult<Json<SongIdsResponse>> {
    let songs = search_songs_for_queue(&state.database, user.user_id, &params.query, &params)
        .await
        .map_err(|e| Error::Internal(format!("Failed to fetch song IDs: {}", e)))?;

    let ids: Vec<String> = songs.into_iter().map(|song| song.id).collect();
    let total = ids.len() as i64;
    Ok(Json(SongIdsResponse { ids, total }))
}

// Media Streaming Endpoints (Wrapped from Subsonic)

/// GET /ferrotune/stream - Stream audio
pub async fn stream(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    headers: HeaderMap,
    query: Query<crate::api::subsonic::stream::StreamParams>,
) -> FerrotuneApiResult<Response> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::stream::stream(sub_user, state, headers, query)
        .await
        .map_err(FerrotuneApiError::from)
}

/// GET /ferrotune/cover-art - Get cover art
pub async fn get_cover_art(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    query: Query<crate::api::subsonic::coverart::CoverArtParams>,
) -> FerrotuneApiResult<Response> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::coverart::get_cover_art(sub_user, state, query)
        .await
        .map_err(FerrotuneApiError::from)
}

/// GET /ferrotune/download - Download audio file
pub async fn download(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    headers: HeaderMap,
    query: Query<crate::api::subsonic::stream::StreamParams>,
) -> FerrotuneApiResult<Response> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::stream::download(sub_user, state, headers, query)
        .await
        .map_err(FerrotuneApiError::from)
}
