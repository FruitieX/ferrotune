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
use uuid::Uuid;

type ApiError = (StatusCode, Json<super::ErrorResponse>);

/// A playlist folder in the response.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistFolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub created_at: String,
}

/// A playlist in the folder response.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInFolder {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub position: i64,
    pub song_count: i64,
}

/// Response containing all folders and playlists.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
