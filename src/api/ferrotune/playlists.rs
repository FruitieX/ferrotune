//! Playlist folder management endpoints for the Ferrotune Admin API.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

type ApiError = (StatusCode, Json<super::ErrorResponse>);

/// A playlist folder in the response.
#[derive(Debug, Serialize, sqlx::FromRow, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistFolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub created_at: String,
}

/// A playlist in the folder response.
#[derive(Debug, Serialize, sqlx::FromRow, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistInFolder {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub position: i64,
    pub song_count: i64,
}

/// Response containing all folders and playlists.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistFoldersResponse {
    pub folders: Vec<PlaylistFolderResponse>,
    pub playlists: Vec<PlaylistInFolder>,
}

/// Get all playlist folders and playlists for the current user.
pub async fn get_playlist_folders(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<PlaylistFoldersResponse>, ApiError> {
    // Get folders
    let folders: Vec<PlaylistFolderResponse> = sqlx::query_as(
        r#"
        SELECT id, name, parent_id, position, 
               strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
        FROM playlist_folders
        WHERE owner_id = ?
        ORDER BY position, name
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Get playlists with folder info
    let playlists: Vec<PlaylistInFolder> = sqlx::query_as(
        r#"
        SELECT id, name, folder_id, position, song_count
        FROM playlists
        WHERE owner_id = ?
        ORDER BY position, name
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    Ok(Json(PlaylistFoldersResponse { folders, playlists }))
}

/// Request to create a playlist folder.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

/// Create a new playlist folder.
pub async fn create_playlist_folder(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<CreateFolderRequest>,
) -> Result<Json<PlaylistFolderResponse>, ApiError> {
    let id = Uuid::new_v4().to_string();

    // Validate parent if provided
    if let Some(ref parent_id) = request.parent_id {
        let parent_exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM playlist_folders WHERE id = ? AND owner_id = ?")
                .bind(parent_id)
                .bind(user.user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(super::ErrorResponse::with_details(
                            "Database error",
                            e.to_string(),
                        )),
                    )
                })?;

        if parent_exists.is_none() {
            return Err((
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse::new("Parent folder not found")),
            ));
        }
    }

    // Get next position
    let next_position: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(position), -1) + 1
        FROM playlist_folders
        WHERE owner_id = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))
        "#,
    )
    .bind(user.user_id)
    .bind(&request.parent_id)
    .bind(&request.parent_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    sqlx::query(
        r#"
        INSERT INTO playlist_folders (id, name, parent_id, owner_id, position)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&request.name)
    .bind(&request.parent_id)
    .bind(user.user_id)
    .bind(next_position)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Fetch the created folder
    let folder: PlaylistFolderResponse = sqlx::query_as(
        r#"
        SELECT id, name, parent_id, position, 
               strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
        FROM playlist_folders
        WHERE id = ?
        "#,
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    Ok(Json(folder))
}

/// Request to update a playlist folder.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolderRequest {
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>, // None = don't change, Some(None) = move to root, Some(Some(id)) = move to folder
}

/// Update a playlist folder.
pub async fn update_playlist_folder(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(folder_id): Path<String>,
    Json(request): Json<UpdateFolderRequest>,
) -> Result<Json<PlaylistFolderResponse>, ApiError> {
    // Check folder exists and belongs to user
    let folder: Option<(String,)> =
        sqlx::query_as("SELECT id FROM playlist_folders WHERE id = ? AND owner_id = ?")
            .bind(&folder_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;

    if folder.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Folder not found")),
        ));
    }

    // Update name if provided
    if let Some(ref name) = request.name {
        sqlx::query("UPDATE playlist_folders SET name = ? WHERE id = ?")
            .bind(name)
            .bind(&folder_id)
            .execute(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;
    }

    // Update parent if provided
    if let Some(new_parent) = request.parent_id {
        // Validate new parent if not moving to root
        if let Some(ref parent_id) = new_parent {
            // Check it's not trying to move to itself
            if parent_id == &folder_id {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(super::ErrorResponse::new("Cannot move folder into itself")),
                ));
            }

            let parent_exists: Option<(i32,)> =
                sqlx::query_as("SELECT 1 FROM playlist_folders WHERE id = ? AND owner_id = ?")
                    .bind(parent_id)
                    .bind(user.user_id)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(super::ErrorResponse::with_details(
                                "Database error",
                                e.to_string(),
                            )),
                        )
                    })?;

            if parent_exists.is_none() {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(super::ErrorResponse::new("Parent folder not found")),
                ));
            }
        }

        sqlx::query("UPDATE playlist_folders SET parent_id = ? WHERE id = ?")
            .bind(&new_parent)
            .bind(&folder_id)
            .execute(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;
    }

    // Fetch the updated folder
    let folder: PlaylistFolderResponse = sqlx::query_as(
        r#"
        SELECT id, name, parent_id, position, 
               strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
        FROM playlist_folders
        WHERE id = ?
        "#,
    )
    .bind(&folder_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    Ok(Json(folder))
}

/// Delete a playlist folder.
pub async fn delete_playlist_folder(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(folder_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    // Check folder exists and belongs to user
    let result = sqlx::query("DELETE FROM playlist_folders WHERE id = ? AND owner_id = ?")
        .bind(&folder_id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Folder not found")),
        ));
    }

    // Playlists in this folder will have their folder_id set to NULL due to ON DELETE SET NULL

    Ok(StatusCode::NO_CONTENT)
}

/// Request to move a playlist to a folder.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePlaylistRequest {
    pub folder_id: Option<String>, // None = move to root
}

/// Move a playlist to a folder.
pub async fn move_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MovePlaylistRequest>,
) -> Result<StatusCode, ApiError> {
    // Check playlist exists and belongs to user
    let playlist: Option<(String,)> =
        sqlx::query_as("SELECT id FROM playlists WHERE id = ? AND owner_id = ?")
            .bind(&playlist_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;

    if playlist.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Playlist not found")),
        ));
    }

    // Validate folder if provided
    if let Some(ref folder_id) = request.folder_id {
        let folder_exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM playlist_folders WHERE id = ? AND owner_id = ?")
                .bind(folder_id)
                .bind(user.user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(super::ErrorResponse::with_details(
                            "Database error",
                            e.to_string(),
                        )),
                    )
                })?;

        if folder_exists.is_none() {
            return Err((
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse::new("Folder not found")),
            ));
        }
    }

    sqlx::query("UPDATE playlists SET folder_id = ? WHERE id = ?")
        .bind(&request.folder_id)
        .bind(&playlist_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to reorder songs in a playlist.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPlaylistRequest {
    /// The new order of song IDs. Must contain all existing song IDs.
    pub song_ids: Vec<String>,
}

/// Reorder songs in a playlist.
pub async fn reorder_playlist_songs(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<ReorderPlaylistRequest>,
) -> Result<StatusCode, ApiError> {
    // Check playlist exists and belongs to user
    let playlist: Option<(String,)> =
        sqlx::query_as("SELECT id FROM playlists WHERE id = ? AND owner_id = ?")
            .bind(&playlist_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;

    if playlist.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Playlist not found")),
        ));
    }

    // Verify all provided song IDs are in the playlist
    let existing_song_ids: Vec<String> = sqlx::query_scalar(
        "SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY position",
    )
    .bind(&playlist_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Check that the reorder request contains the same songs
    let mut existing_sorted = existing_song_ids.clone();
    let mut requested_sorted = request.song_ids.clone();
    existing_sorted.sort();
    requested_sorted.sort();

    if existing_sorted != requested_sorted {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse::new(
                "Song IDs must match existing playlist songs",
            )),
        ));
    }

    // Update positions in a transaction
    // We need to delete all songs and re-insert them to avoid UNIQUE constraint violations
    let mut tx = state.pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Delete all songs from the playlist
    sqlx::query("DELETE FROM playlist_songs WHERE playlist_id = ?")
        .bind(&playlist_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?;

    // Re-insert songs in the new order
    for (position, song_id) in request.song_ids.iter().enumerate() {
        sqlx::query("INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)")
            .bind(&playlist_id)
            .bind(song_id)
            .bind(position as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to match a missing playlist entry to a song
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchMissingEntryRequest {
    /// The position of the missing entry in the playlist
    pub position: i32,
    /// The song ID to match the entry to
    pub song_id: String,
}

/// Match a missing entry in a playlist to an existing song
pub async fn match_missing_entry(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MatchMissingEntryRequest>,
) -> Result<StatusCode, ApiError> {
    // Check playlist exists and belongs to user
    let playlist: Option<(String,)> =
        sqlx::query_as("SELECT id FROM playlists WHERE id = ? AND owner_id = ?")
            .bind(&playlist_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;

    if playlist.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Playlist not found")),
        ));
    }

    // Verify the entry exists at this position and is missing
    let entry: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT song_id, missing_entry_data FROM playlist_songs WHERE playlist_id = ? AND position = ?"
    )
    .bind(&playlist_id)
    .bind(request.position)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    let Some((song_id, missing_data)) = entry else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Entry not found at position")),
        ));
    };

    // Only allow matching if this is a missing entry
    if song_id.is_some() && missing_data.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse::new("Entry is already matched")),
        ));
    }

    // Verify the song exists
    let song_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM songs WHERE id = ?")
        .bind(&request.song_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?;

    if song_exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Song not found")),
        ));
    }

    // Update the entry to link to the song
    crate::db::queries::match_missing_entry(&state.pool, &playlist_id, request.position, &request.song_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to move a playlist entry to a new position
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePlaylistEntryRequest {
    /// Current position of the entry (0-indexed)
    pub from_position: i32,
    /// New position to move to (0-indexed)
    pub to_position: i32,
}

/// Move a playlist entry to a new position
pub async fn move_playlist_entry(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MovePlaylistEntryRequest>,
) -> Result<StatusCode, ApiError> {
    let from_pos = request.from_position as i64;
    let to_pos = request.to_position as i64;
    
    if from_pos == to_pos {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Check playlist exists and belongs to user
    let playlist: Option<(String,)> =
        sqlx::query_as("SELECT id FROM playlists WHERE id = ? AND owner_id = ?")
            .bind(&playlist_id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;

    if playlist.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Playlist not found")),
        ));
    }

    // Get count of entries to validate positions
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?"
    )
    .bind(&playlist_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    if from_pos < 0 || from_pos >= count || to_pos < 0 || to_pos >= count {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse::new("Invalid position")),
        ));
    }

    // Move the entry in a transaction
    let mut tx = state.pool.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Temporarily move the item to a negative position to avoid conflicts
    sqlx::query(
        "UPDATE playlist_songs SET position = -1 WHERE playlist_id = ? AND position = ?"
    )
    .bind(&playlist_id)
    .bind(from_pos)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Shift positions of entries between from and to
    // We shift one row at a time to avoid UNIQUE constraint violations
    if from_pos < to_pos {
        // Moving down: shift entries up one at a time, starting from the lowest position
        for pos in (from_pos + 1)..=to_pos {
            sqlx::query(
                "UPDATE playlist_songs SET position = position - 1 
                 WHERE playlist_id = ? AND position = ?"
            )
            .bind(&playlist_id)
            .bind(pos)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;
        }
    } else {
        // Moving up: shift entries down one at a time, starting from the highest position
        for pos in (to_pos..from_pos).rev() {
            sqlx::query(
                "UPDATE playlist_songs SET position = position + 1 
                 WHERE playlist_id = ? AND position = ?"
            )
            .bind(&playlist_id)
            .bind(pos)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details(
                        "Database error",
                        e.to_string(),
                    )),
                )
            })?;
        }
    }

    // Move the item to its final position
    sqlx::query(
        "UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND position = -1"
    )
    .bind(to_pos)
    .bind(&playlist_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// A missing entry in an import request
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportMissingEntry {
    /// Track title
    pub title: Option<String>,
    /// Artist name
    pub artist: Option<String>,
    /// Album name
    pub album: Option<String>,
    /// Duration in seconds (if known)
    pub duration: Option<i32>,
    /// Original raw line from the playlist file
    pub raw: String,
}

/// Entry for the import request - either a matched song or a missing entry
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportPlaylistEntry {
    /// Song ID if matched
    pub song_id: Option<String>,
    /// Missing entry data if not matched
    pub missing: Option<ImportMissingEntry>,
}

/// Request to import a playlist with optional missing entries
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportPlaylistRequest {
    /// Name of the playlist to create
    pub name: String,
    /// Optional comment/description
    pub comment: Option<String>,
    /// Entries in the playlist (can include missing entries)
    pub entries: Vec<ImportPlaylistEntry>,
}

/// Response from importing a playlist
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportPlaylistResponse {
    /// ID of the created playlist
    pub playlist_id: String,
    /// Number of matched tracks
    pub matched_count: i32,
    /// Number of missing/unmatched tracks
    pub missing_count: i32,
}

/// Import a playlist with support for missing entries
pub async fn import_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<ImportPlaylistRequest>,
) -> Result<Json<ImportPlaylistResponse>, ApiError> {
    use crate::db::queries::{add_entries_to_playlist, create_playlist, PlaylistEntry};
    use crate::db::models::MissingEntryData;
    
    /// Build search text from missing entry fields in "artist - album - title" format
    fn build_missing_search_text(artist: Option<&str>, album: Option<&str>, title: Option<&str>, raw: &str) -> String {
        let mut parts = Vec::new();
        if let Some(a) = artist {
            if !a.is_empty() {
                parts.push(a);
            }
        }
        if let Some(a) = album {
            if !a.is_empty() {
                parts.push(a);
            }
        }
        if let Some(t) = title {
            if !t.is_empty() {
                parts.push(t);
            }
        }
        if parts.is_empty() {
            raw.to_string()
        } else {
            parts.join(" - ")
        }
    }
    
    // Generate playlist ID
    let playlist_id = format!("pl-{}", Uuid::new_v4());

    // Create the playlist
    create_playlist(&state.pool, &playlist_id, &request.name, user.user_id, request.comment.as_deref(), false)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Failed to create playlist",
                    e.to_string(),
                )),
            )
        })?;

    // Convert import entries to playlist entries
    let mut matched_count = 0i32;
    let mut missing_count = 0i32;
    
    let entries: Vec<PlaylistEntry> = request
        .entries
        .into_iter()
        .map(|entry| {
            if let Some(song_id) = entry.song_id {
                matched_count += 1;
                PlaylistEntry {
                    song_id: Some(song_id),
                    missing_entry_data: None,
                    missing_search_text: None,
                }
            } else if let Some(missing) = entry.missing {
                missing_count += 1;
                // Build search text from missing entry fields
                let search_text = build_missing_search_text(
                    missing.artist.as_deref(),
                    missing.album.as_deref(),
                    missing.title.as_deref(),
                    &missing.raw,
                );
                PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(MissingEntryData {
                        title: missing.title,
                        artist: missing.artist,
                        album: missing.album,
                        duration: missing.duration,
                        raw: missing.raw,
                    }),
                    missing_search_text: Some(search_text),
                }
            } else {
                // Skip empty entries
                PlaylistEntry {
                    song_id: None,
                    missing_entry_data: None,
                    missing_search_text: None,
                }
            }
        })
        .filter(|e| e.song_id.is_some() || e.missing_entry_data.is_some())
        .collect();

    // Add entries to the playlist
    add_entries_to_playlist(&state.pool, &playlist_id, &entries)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Failed to add entries to playlist",
                    e.to_string(),
                )),
            )
        })?;

    Ok(Json(ImportPlaylistResponse {
        playlist_id,
        matched_count,
        missing_count,
    }))
}

/// An entry in the playlist entries response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistEntryResponse {
    /// Position in the playlist (0-indexed)
    pub position: i32,
    /// Song ID if matched (null for missing entries)
    pub song_id: Option<String>,
    /// Missing entry data if not matched
    pub missing: Option<MissingEntryDataResponse>,
}

/// Missing entry data in the response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MissingEntryDataResponse {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<i32>,
    pub raw: String,
}

/// Response containing playlist entries (including missing)
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistEntriesResponse {
    /// Total entries in the playlist
    pub total: i32,
    /// Number of matched entries
    pub matched: i32,
    /// Number of missing entries
    pub missing: i32,
    /// Entries in position order
    pub entries: Vec<PlaylistEntryResponse>,
}

// ============================================================================
// Paginated Playlist Songs Endpoint (unified songs + missing entries)
// ============================================================================

/// Query parameters for paginated playlist songs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPlaylistSongsParams {
    /// Offset for pagination (number of entries to skip)
    #[serde(default)]
    pub offset: Option<u32>,
    /// Number of entries to return (for pagination)
    #[serde(default)]
    pub count: Option<u32>,
    /// Sort field: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

/// A unified playlist entry - either a song or a missing entry
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistSongEntry {
    /// Position in the playlist (0-indexed, from original playlist order)
    pub position: i32,
    /// Type of entry: "song" or "missing"
    pub entry_type: String,
    /// Song data (only present if entry_type is "song")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song: Option<crate::api::subsonic::browse::SongResponse>,
    /// Missing entry data (only present if entry_type is "missing")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<MissingEntryDataResponse>,
}

/// Response for paginated playlist songs
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistSongsResponse {
    /// Playlist metadata
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub owner: String,
    pub public: bool,
    /// Total entries in playlist (songs + missing)
    #[ts(type = "number")]
    pub total_entries: i64,
    /// Total matched songs
    #[ts(type = "number")]
    pub matched_count: i64,
    /// Total missing entries
    #[ts(type = "number")]
    pub missing_count: i64,
    /// Total duration of matched songs in seconds
    #[ts(type = "number")]
    pub duration: i64,
    /// Total count after filtering (before pagination)
    #[ts(type = "number")]
    pub filtered_count: i64,
    /// Created timestamp
    pub created: String,
    /// Last changed timestamp
    pub changed: String,
    /// Cover art ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Entries in the requested page (interleaved songs and missing entries)
    pub entries: Vec<PlaylistSongEntry>,
}

/// Get paginated playlist songs with interleaved missing entries.
/// 
/// This endpoint replaces both `getPlaylist` (for songs) and `get_playlist_entries` 
/// (for missing entries) with a single endpoint that returns both interleaved.
/// 
/// The entries are returned in their original playlist positions, which is important
/// for queue materialization to correctly map display indices to playback indices.
pub async fn get_playlist_songs(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<GetPlaylistSongsParams>,
) -> Result<Json<PlaylistSongsResponse>, ApiError> {
    use crate::api::subsonic::browse::song_to_response;
    use crate::db::models::MissingEntryData;

    // Get playlist metadata
    let playlist = crate::db::queries::get_playlist_by_id(&state.pool, &playlist_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details("Database error", e.to_string())),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse::new("Playlist not found")),
            )
        })?;

    // Check access: user must own playlist or it must be public
    if playlist.owner_id != user.user_id && !playlist.is_public {
        return Err((
            StatusCode::FORBIDDEN,
            Json(super::ErrorResponse::new("Not authorized to access this playlist")),
        ));
    }

    // Get all playlist entries (positions, song_ids, missing data)
    let entries_raw: Vec<(i64, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT position, song_id, missing_entry_data, missing_search_text 
         FROM playlist_songs 
         WHERE playlist_id = ? 
         ORDER BY position"
    )
    .bind(&playlist_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details("Database error", e.to_string())),
        )
    })?;

    // Count totals
    let total_entries = entries_raw.len() as i64;
    let matched_count = entries_raw.iter().filter(|(_, sid, _, _)| sid.is_some()).count() as i64;
    let missing_count = entries_raw.iter().filter(|(_, _, md, _)| md.is_some()).count() as i64;

    // Get all song IDs that are not null
    let song_ids: Vec<String> = entries_raw
        .iter()
        .filter_map(|(_, sid, _, _)| sid.clone())
        .collect();

    // Fetch all songs at once
    let songs = if !song_ids.is_empty() {
        crate::db::queries::get_songs_by_ids(&state.pool, &song_ids)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::with_details("Database error", e.to_string())),
                )
            })?
    } else {
        vec![]
    };

    // Create a lookup map from song_id -> Song
    let song_map: std::collections::HashMap<String, crate::db::models::Song> = 
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();

    // Determine sort mode
    let sort_field = params.sort.as_deref().unwrap_or("custom");
    let sort_dir = params.sort_dir.as_deref().unwrap_or("asc");
    let filter_text = params.filter.as_deref();
    let has_filter = filter_text.map(|f| !f.trim().is_empty()).unwrap_or(false);
    let is_custom_sort = sort_field == "custom";

    // Build unified entry list with position info
    #[derive(Clone)]
    enum EntryData {
        Song { position: i64, song: crate::db::models::Song },
        Missing { position: i64, data: MissingEntryData },
    }

    let mut unified_entries: Vec<EntryData> = entries_raw
        .into_iter()
        .filter_map(|(position, song_id, missing_json, _missing_search_text)| {
            if let Some(sid) = song_id {
                // Matched song
                if let Some(song) = song_map.get(&sid) {
                    Some(EntryData::Song { position, song: song.clone() })
                } else {
                    None // Song was deleted?
                }
            } else if let Some(json) = missing_json {
                // Missing entry
                if let Ok(data) = serde_json::from_str::<MissingEntryData>(&json) {
                    Some(EntryData::Missing { position, data })
                } else {
                    None
                }
            } else {
                None // Empty entry?
            }
        })
        .collect();

    // Apply filtering
    if has_filter {
        let query = filter_text.unwrap().to_lowercase();
        unified_entries.retain(|entry| match entry {
            EntryData::Song { song, .. } => {
                song.title.to_lowercase().contains(&query)
                    || song.artist_name.to_lowercase().contains(&query)
                    || song.album_name.as_deref().unwrap_or("").to_lowercase().contains(&query)
            }
            EntryData::Missing { data, .. } => {
                // Filter missing entries by their metadata
                data.title.as_deref().unwrap_or("").to_lowercase().contains(&query)
                    || data.artist.as_deref().unwrap_or("").to_lowercase().contains(&query)
                    || data.album.as_deref().unwrap_or("").to_lowercase().contains(&query)
                    || data.raw.to_lowercase().contains(&query)
            }
        });
    }

    // Apply sorting
    if !is_custom_sort {
        // When sorting by a specific field, we need to decide how to handle missing entries.
        // Missing entries don't have sortable metadata, so we exclude them when sorting by
        // specific fields. They are only shown in "custom" (playlist order) mode.
        unified_entries.retain(|entry| matches!(entry, EntryData::Song { .. }));
        
        // Sort songs
        unified_entries.sort_by(|a, b| {
            let (song_a, song_b) = match (a, b) {
                (EntryData::Song { song: sa, .. }, EntryData::Song { song: sb, .. }) => (sa, sb),
                _ => unreachable!(), // We filtered out missing entries above
            };

            let cmp = match sort_field {
                "name" | "title" => song_a.title.to_lowercase().cmp(&song_b.title.to_lowercase()),
                "artist" => song_a.artist_name.to_lowercase().cmp(&song_b.artist_name.to_lowercase()),
                "album" => {
                    let a_album = song_a.album_name.as_deref().unwrap_or("");
                    let b_album = song_b.album_name.as_deref().unwrap_or("");
                    a_album.to_lowercase().cmp(&b_album.to_lowercase())
                }
                "year" => song_a.year.unwrap_or(0).cmp(&song_b.year.unwrap_or(0)),
                "dateAdded" | "created" => song_a.created_at.cmp(&song_b.created_at),
                "playCount" => song_a.play_count.unwrap_or(0).cmp(&song_b.play_count.unwrap_or(0)),
                "lastPlayed" => song_a.last_played.cmp(&song_b.last_played),
                "duration" => song_a.duration.cmp(&song_b.duration),
                _ => std::cmp::Ordering::Equal,
            };
            cmp
        });

        if sort_dir == "desc" {
            unified_entries.reverse();
        }
    } else if sort_dir == "desc" {
        // Custom sort with desc = reverse playlist order
        unified_entries.reverse();
    }

    let filtered_count = unified_entries.len() as i64;

    // Apply pagination
    let offset = params.offset.unwrap_or(0) as usize;
    let count = params.count.unwrap_or(50) as usize;
    let page_entries: Vec<_> = unified_entries
        .into_iter()
        .skip(offset)
        .take(count)
        .collect();

    // Convert to response format
    let entries: Vec<PlaylistSongEntry> = page_entries
        .into_iter()
        .map(|entry| match entry {
            EntryData::Song { position, song } => PlaylistSongEntry {
                position: position as i32,
                entry_type: "song".to_string(),
                song: Some(song_to_response(song, None, None, None)),
                missing: None,
            },
            EntryData::Missing { position, data } => PlaylistSongEntry {
                position: position as i32,
                entry_type: "missing".to_string(),
                song: None,
                missing: Some(MissingEntryDataResponse {
                    title: data.title,
                    artist: data.artist,
                    album: data.album,
                    duration: data.duration,
                    raw: data.raw,
                }),
            },
        })
        .collect();

    // Build cover art reference
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    Ok(Json(PlaylistSongsResponse {
        id: playlist.id,
        name: playlist.name,
        comment: playlist.comment,
        owner: user.username.clone(),
        public: playlist.is_public,
        total_entries,
        matched_count,
        missing_count,
        duration: playlist.duration,
        filtered_count,
        created: playlist.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        changed: playlist.updated_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        cover_art,
        entries,
    }))
}

/// Get playlist entries including missing ones
/// 
/// @deprecated Use `get_playlist_songs` instead which returns songs with entries interleaved
#[allow(dead_code)]
pub async fn get_playlist_entries(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(playlist_id): Path<String>,
) -> Result<Json<PlaylistEntriesResponse>, ApiError> {
    use crate::db::models::MissingEntryData;
    
    // Check playlist exists and belongs to user
    let playlist: Option<(String, i64, bool)> = sqlx::query_as(
        "SELECT id, owner_id, is_public FROM playlists WHERE id = ?"
    )
    .bind(&playlist_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    let Some((_, owner_id, is_public)) = playlist else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Playlist not found")),
        ));
    };

    // Check access
    if owner_id != user.user_id as i64 && !is_public {
        return Err((
            StatusCode::FORBIDDEN,
            Json(super::ErrorResponse::new("Not authorized to access this playlist")),
        ));
    }

    // Get all entries (both matched and missing)
    let rows: Vec<(i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT position, song_id, missing_entry_data FROM playlist_songs WHERE playlist_id = ? ORDER BY position"
    )
    .bind(&playlist_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    let mut matched_count = 0i32;
    let mut missing_count = 0i32;

    let entries: Vec<PlaylistEntryResponse> = rows
        .into_iter()
        .map(|(position, song_id, missing_data)| {
            if song_id.is_some() {
                matched_count += 1;
            }
            
            let missing = if let Some(data_str) = missing_data {
                if let Ok(data) = serde_json::from_str::<MissingEntryData>(&data_str) {
                    missing_count += 1;
                    Some(MissingEntryDataResponse {
                        title: data.title,
                        artist: data.artist,
                        album: data.album,
                        duration: data.duration,
                        raw: data.raw,
                    })
                } else {
                    None
                }
            } else {
                None
            };

            PlaylistEntryResponse {
                position: position as i32,
                song_id,
                missing,
            }
        })
        .collect();

    let total = entries.len() as i32;

    Ok(Json(PlaylistEntriesResponse {
        total,
        matched: matched_count,
        missing: missing_count,
        entries,
    }))
}
