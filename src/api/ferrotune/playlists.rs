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

/// Get playlist entries including missing ones
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
