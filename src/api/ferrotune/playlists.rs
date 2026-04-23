//! Playlist folder management endpoints for the Ferrotune Admin API.

use crate::api::common::models::SongPlayStats;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::{format_datetime_iso, format_datetime_iso_ms};
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{get_song_thumbnails_base64, InlineImagesParam};
use crate::api::subsonic::query::QsQuery;
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::db::repo::playlists as playlists_repo;
use crate::db::Database;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

/// A playlist folder in the response.
#[derive(Debug, Serialize, sea_orm::FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistFolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    #[ts(type = "number")]
    pub position: i64,
    pub created_at: String,
    /// Whether this folder has custom cover art
    pub has_cover_art: bool,
}

/// A playlist in the folder response.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistInFolder {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub song_count: i64,
    /// Total duration of all songs in the playlist (seconds)
    #[ts(type = "number")]
    pub duration: i64,
    /// Owner username (present for shared playlists)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Whether this playlist was shared with the current user
    #[serde(default)]
    pub shared_with_me: bool,
    /// Whether the current user can edit this shared playlist
    #[serde(default)]
    pub can_edit: bool,
    /// When the playlist was last updated (ISO 8601)
    pub updated_at: String,
}

/// Response containing all folders and playlists.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistFoldersResponse {
    pub folders: Vec<PlaylistFolderResponse>,
    pub playlists: Vec<PlaylistInFolder>,
}

async fn playlist_folder_exists(
    database: &Database,
    folder_id: &str,
    user_id: i64,
) -> crate::error::Result<bool> {
    playlists_repo::playlist_folder_exists(database, folder_id, user_id).await
}

async fn next_playlist_folder_position(
    database: &Database,
    user_id: i64,
    parent_id: Option<&str>,
) -> crate::error::Result<i64> {
    playlists_repo::next_playlist_folder_position(database, user_id, parent_id).await
}

async fn fetch_playlist_folder_response(
    database: &Database,
    folder_id: &str,
) -> crate::error::Result<PlaylistFolderResponse> {
    playlists_repo::fetch_playlist_folder(database, folder_id)
        .await?
        .map(|folder| PlaylistFolderResponse {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
            position: folder.position,
            created_at: format_datetime_iso(folder.created_at.with_timezone(&Utc)),
            has_cover_art: folder.has_cover_art,
        })
        .ok_or_else(|| Error::NotFound(format!("playlist folder {} not found", folder_id)))
}

async fn playlist_owner_id(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<Option<i64>> {
    playlists_repo::playlist_owner_id(database, playlist_id).await
}

async fn user_exists(database: &Database, user_id: i64) -> crate::error::Result<bool> {
    playlists_repo::user_exists(database, user_id).await
}

async fn username_for_user(database: &Database, user_id: i64) -> crate::error::Result<String> {
    playlists_repo::username_for_user(database, user_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("user {} not found", user_id)))
}

async fn fetch_playlist_shares(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<Vec<PlaylistShareResponse>> {
    playlists_repo::fetch_playlist_shares(database, playlist_id)
        .await
        .map(|shares| {
            shares
                .into_iter()
                .map(|share| PlaylistShareResponse {
                    user_id: share.user_id,
                    username: share.username,
                    can_edit: share.can_edit,
                })
                .collect()
        })
}

pub async fn get_playlist_folders(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
) -> FerrotuneApiResult<Json<PlaylistFoldersResponse>> {
    let folders = playlists_repo::list_playlist_folders_for_user(&state.database, user.user_id)
        .await?
        .into_iter()
        .map(|folder| PlaylistFolderResponse {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
            position: folder.position,
            created_at: format_datetime_iso(folder.created_at.with_timezone(&Utc)),
            has_cover_art: folder.has_cover_art,
        })
        .collect();

    let playlists = playlists_repo::list_visible_playlists_for_user(&state.database, user.user_id)
        .await?
        .into_iter()
        .map(|playlist| PlaylistInFolder {
            id: playlist.id,
            name: playlist.name,
            folder_id: playlist.folder_id,
            position: playlist.position,
            song_count: playlist.song_count,
            duration: playlist.duration,
            owner: playlist.owner_name,
            shared_with_me: playlist.shared_with_me,
            can_edit: playlist.can_edit,
            updated_at: format_datetime_iso(playlist.updated_at.with_timezone(&Utc)),
        })
        .collect();

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
    user: FerrotuneAuthenticatedUser,
    Json(request): Json<CreateFolderRequest>,
) -> FerrotuneApiResult<Json<PlaylistFolderResponse>> {
    let id = Uuid::new_v4().to_string();

    // Validate parent if provided
    if let Some(ref parent_id) = request.parent_id {
        if !playlist_folder_exists(&state.database, parent_id, user.user_id).await? {
            return Err(Error::NotFound("Parent folder not found".to_string()).into());
        }
    }

    // Get next position
    let next_position =
        next_playlist_folder_position(&state.database, user.user_id, request.parent_id.as_deref())
            .await?;

    playlists_repo::create_playlist_folder(
        &state.database,
        &id,
        &request.name,
        request.parent_id.as_deref(),
        user.user_id,
        next_position,
    )
    .await?;

    let folder = fetch_playlist_folder_response(&state.database, &id).await?;

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
    user: FerrotuneAuthenticatedUser,
    Path(folder_id): Path<String>,
    Json(request): Json<UpdateFolderRequest>,
) -> FerrotuneApiResult<Json<PlaylistFolderResponse>> {
    // Check folder exists and belongs to user
    if !playlist_folder_exists(&state.database, &folder_id, user.user_id).await? {
        return Err(Error::NotFound("Folder not found".to_string()).into());
    }

    // Update name if provided
    if let Some(ref name) = request.name {
        playlists_repo::update_playlist_folder_name(&state.database, &folder_id, name).await?;
    }

    // Update parent if provided
    if let Some(new_parent) = request.parent_id {
        // Validate new parent if not moving to root
        if let Some(ref parent_id) = new_parent {
            // Check it's not trying to move to itself
            if parent_id == &folder_id {
                return Err(
                    Error::InvalidRequest("Cannot move folder into itself".to_string()).into(),
                );
            }

            if !playlist_folder_exists(&state.database, parent_id, user.user_id).await? {
                return Err(Error::NotFound("Parent folder not found".to_string()).into());
            }
        }

        playlists_repo::update_playlist_folder_parent(
            &state.database,
            &folder_id,
            new_parent.as_deref(),
        )
        .await?;
    }

    let folder = fetch_playlist_folder_response(&state.database, &folder_id).await?;

    Ok(Json(folder))
}

/// Delete a playlist folder.
pub async fn delete_playlist_folder(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(folder_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    // Check folder exists and belongs to user
    if !playlists_repo::delete_playlist_folder(&state.database, &folder_id, user.user_id).await? {
        return Err(Error::NotFound("Folder not found".to_string()).into());
    }

    // Playlists in this folder will have their folder_id set to NULL due to ON DELETE SET NULL

    Ok(StatusCode::NO_CONTENT)
}

/// Upload cover art for a playlist folder.
pub async fn upload_playlist_folder_cover(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(folder_id): Path<String>,
    body: axum::body::Bytes,
) -> FerrotuneApiResult<StatusCode> {
    // Validate it's an image by checking magic bytes
    if body.len() < 4 {
        return Err(Error::InvalidRequest("Invalid image data".to_string()).into());
    }

    let is_valid_image = body.starts_with(&[0xFF, 0xD8, 0xFF]) // JPEG
        || body.starts_with(&[0x89, 0x50, 0x4E, 0x47]) // PNG
        || body.starts_with(b"GIF8") // GIF
        || (body.starts_with(b"RIFF") && body.len() > 11 && &body[8..12] == b"WEBP"); // WebP

    if !is_valid_image {
        return Err(Error::InvalidRequest(
            "Invalid image format. Supported: JPEG, PNG, GIF, WebP".to_string(),
        )
        .into());
    }

    // Check folder exists and belongs to user
    if !playlist_folder_exists(&state.database, &folder_id, user.user_id).await? {
        return Err(Error::NotFound("Folder not found".to_string()).into());
    }

    // Update the cover_art blob
    playlists_repo::set_playlist_folder_cover(&state.database, &folder_id, body.to_vec()).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Delete cover art for a playlist folder.
pub async fn delete_playlist_folder_cover(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(folder_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    // Check folder exists and belongs to user
    if !playlists_repo::clear_playlist_folder_cover(&state.database, &folder_id, user.user_id)
        .await?
    {
        return Err(Error::NotFound("Folder not found".to_string()).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Request to move a playlist to a folder.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePlaylistRequest {
    pub folder_id: Option<String>, // None = move to root
}

/// Move a playlist to a folder.
///
/// For owned playlists, updates the playlist's folder_id directly.
/// For non-owned playlists (shared/public), stores a per-user override
/// in user_playlist_overrides without affecting the owner's view.
pub async fn move_playlist(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MovePlaylistRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_read {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Validate folder if provided (must belong to the current user)
    if let Some(ref folder_id) = request.folder_id {
        if !playlist_folder_exists(&state.database, folder_id, user.user_id).await? {
            return Err(Error::NotFound("Folder not found".to_string()).into());
        }
    }

    if access.is_owner {
        // Owner: update the playlist's folder_id directly
        crate::db::repo::playlists::set_playlist_folder_id(
            &state.database,
            &playlist_id,
            request.folder_id.clone(),
        )
        .await?;
    } else {
        // Non-owner: store a per-user override
        if request.folder_id.is_some() {
            crate::db::repo::playlists::upsert_user_playlist_override(
                &state.database,
                user.user_id,
                &playlist_id,
                request.folder_id.clone(),
            )
            .await?;
        } else {
            // Moving to root: remove the override
            crate::db::repo::playlists::delete_user_playlist_override(
                &state.database,
                user.user_id,
                &playlist_id,
            )
            .await?;
        }
    }

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
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<ReorderPlaylistRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    #[derive(sea_orm::FromQueryResult)]
    struct ExistingEntryRow {
        song_id: String,
        added_at: DateTime<Utc>,
        entry_id: Option<String>,
    }

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Verify all provided song IDs are in the playlist and get their added_at timestamps and entry_ids
    let existing_entries: Vec<ExistingEntryRow> =
        crate::db::repo::playlists::list_playlist_songs_for_reorder(&state.database, &playlist_id)
            .await?
            .into_iter()
            .map(|r| ExistingEntryRow {
                song_id: r.song_id,
                added_at: r.added_at,
                entry_id: r.entry_id,
            })
            .collect();

    // Create a map from song_id to (added_at, entry_id) for preserving timestamps and entry_ids
    let entry_data_map: std::collections::HashMap<String, (DateTime<Utc>, Option<String>)> =
        existing_entries
            .iter()
            .map(|entry| {
                (
                    entry.song_id.clone(),
                    (entry.added_at, entry.entry_id.clone()),
                )
            })
            .collect();

    // Check that the reorder request contains the same songs
    let mut existing_sorted: Vec<String> = existing_entries
        .iter()
        .map(|entry| entry.song_id.clone())
        .collect();
    let mut requested_sorted = request.song_ids.clone();
    existing_sorted.sort();
    requested_sorted.sort();

    if existing_sorted != requested_sorted {
        return Err(Error::InvalidRequest(
            "Song IDs must match existing playlist songs".to_string(),
        )
        .into());
    }

    // Update positions in a transaction
    // We need to delete all songs and re-insert them to avoid UNIQUE constraint violations
    use sea_orm::TransactionTrait;
    let tx = state.database.conn().begin().await?;

    crate::db::repo::playlists::delete_all_playlist_songs(&tx, &playlist_id).await?;

    for (position, song_id) in request.song_ids.iter().enumerate() {
        let (added_at, entry_id) = entry_data_map.get(song_id).cloned().unwrap_or_default();
        let entry_id = entry_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        crate::db::repo::playlists::insert_playlist_song_entry(
            &tx,
            &playlist_id,
            song_id,
            position as i64,
            added_at,
            &entry_id,
        )
        .await?;
    }

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to match a missing playlist entry to a song
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchMissingEntryRequest {
    /// The entry_id of the playlist entry
    pub entry_id: String,
    /// The song ID to match the entry to
    pub song_id: String,
}

/// Match a missing entry in a playlist to an existing song
pub async fn match_missing_entry(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MatchMissingEntryRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Verify the entry exists with this entry_id and has missing_entry_data
    let entry = crate::db::repo::playlists::get_playlist_entry_by_entry_id(
        &state.database,
        &playlist_id,
        &request.entry_id,
    )
    .await?;

    let Some(entry) = entry else {
        return Err(Error::NotFound("Entry not found".to_string()).into());
    };
    let missing_data = entry.missing_entry_data;

    // Only allow matching if this entry has missing_entry_data (either unmatched or previously matched)
    // This allows re-matching songs that were incorrectly matched
    if missing_data.is_none() {
        return Err(Error::InvalidRequest("Entry has no missing data to match".to_string()).into());
    }

    // Verify the song exists
    if !crate::db::repo::playlists::song_exists(&state.database, &request.song_id).await? {
        return Err(Error::NotFound("Song not found".to_string()).into());
    }

    // Update the entry to link to the song using entry_id
    let matched = crate::db::queries::match_missing_entry_by_id(
        &state.database,
        &playlist_id,
        &request.entry_id,
        &request.song_id,
    )
    .await?;

    if !matched {
        return Err(Error::NotFound("Entry not found".to_string()).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Request to unmatch a playlist entry (set back to missing)
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UnmatchEntryRequest {
    /// The entry_id of the playlist entry
    pub entry_id: String,
}

/// Unmatch a playlist entry - sets it back to missing state
/// while preserving the original missing entry data for re-matching.
pub async fn unmatch_entry(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<UnmatchEntryRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Verify the entry exists with this entry_id and has missing_entry_data
    let entry = crate::db::repo::playlists::get_playlist_entry_by_entry_id(
        &state.database,
        &playlist_id,
        &request.entry_id,
    )
    .await?;

    let Some(entry) = entry else {
        return Err(Error::NotFound("Entry not found".to_string()).into());
    };
    let song_id = entry.song_id;
    let missing_data = entry.missing_entry_data;

    // Can only unmatch entries that have missing_entry_data (imported entries)
    if missing_data.is_none() {
        return Err(Error::InvalidRequest(
            "Entry has no missing data - cannot unmatch native entries".to_string(),
        )
        .into());
    }

    // Can only unmatch if currently matched
    if song_id.is_none() {
        return Err(Error::InvalidRequest("Entry is already unmatched".to_string()).into());
    }

    // Unmatch the entry using entry_id
    let unmatched =
        crate::db::queries::unmatch_entry_by_id(&state.database, &playlist_id, &request.entry_id)
            .await?;

    if !unmatched {
        return Err(Error::NotFound("Entry not found".to_string()).into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// A single entry to match in a batch request
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchMatchEntry {
    /// The entry_id of the playlist entry
    pub entry_id: String,
    /// The song ID to match the entry to
    pub song_id: String,
}

/// Request to match multiple missing playlist entries to songs
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchMatchEntriesRequest {
    /// List of entries to match
    pub entries: Vec<BatchMatchEntry>,
}

/// Response from batch matching entries
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BatchMatchEntriesResponse {
    /// Number of successfully matched entries
    pub matched_count: i32,
    /// Number of entries that failed to match
    pub failed_count: i32,
}

/// Batch match multiple missing entries in a playlist to songs
pub async fn batch_match_entries(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<BatchMatchEntriesRequest>,
) -> FerrotuneApiResult<Json<BatchMatchEntriesResponse>> {
    use crate::api::common::playlist_access::get_playlist_access;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Convert to the format the query function expects
    let matches: Vec<(String, String)> = request
        .entries
        .into_iter()
        .map(|e| (e.entry_id, e.song_id))
        .collect();

    // Update the entries
    let success_count =
        crate::db::queries::batch_match_entries(&state.database, &playlist_id, &matches).await?;

    let total = matches.len() as i32;
    Ok(Json(BatchMatchEntriesResponse {
        matched_count: success_count as i32,
        failed_count: total - success_count as i32,
    }))
}

/// Request to move a playlist entry to a new position
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MovePlaylistEntryRequest {
    /// The entry_id of the playlist entry to move
    pub entry_id: String,
    /// New position to move to (0-indexed)
    pub to_position: i32,
}

/// Move a playlist entry to a new position
pub async fn move_playlist_entry(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<MovePlaylistEntryRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    let to_pos = request.to_position as i64;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    }

    // Look up the current position of the entry by entry_id
    let from_pos_result = crate::db::repo::playlists::get_entry_position_by_entry_id(
        &state.database,
        &playlist_id,
        &request.entry_id,
    )
    .await?;

    let Some(from_pos) = from_pos_result else {
        return Err(Error::NotFound("Entry not found".to_string()).into());
    };

    if from_pos == to_pos {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Get count of entries to validate to_position
    let count: i64 =
        crate::db::repo::playlists::count_playlist_entries(&state.database, &playlist_id).await?;

    if to_pos < 0 || to_pos >= count {
        return Err(Error::InvalidRequest("Invalid position".to_string()).into());
    }

    // Move the entry in a transaction
    use sea_orm::TransactionTrait;
    let tx = state.database.conn().begin().await?;

    use sea_orm::sea_query::Expr;
    crate::db::repo::playlists::update_entry_position_at(
        &tx,
        &playlist_id,
        from_pos,
        Expr::value(-1i64),
    )
    .await?;

    if from_pos < to_pos {
        for pos in (from_pos + 1)..=to_pos {
            crate::db::repo::playlists::update_entry_position_at(
                &tx,
                &playlist_id,
                pos,
                Expr::col(crate::db::entity::playlist_songs::Column::Position).sub(1i64),
            )
            .await?;
        }
    } else {
        for pos in (to_pos..from_pos).rev() {
            crate::db::repo::playlists::update_entry_position_at(
                &tx,
                &playlist_id,
                pos,
                Expr::col(crate::db::entity::playlist_songs::Column::Position).add(1i64),
            )
            .await?;
        }
    }

    crate::db::repo::playlists::update_entry_position_at(
        &tx,
        &playlist_id,
        -1,
        Expr::value(to_pos),
    )
    .await?;

    tx.commit().await?;

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
    /// Optional folder ID to create the playlist in
    pub folder_id: Option<String>,
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
    user: FerrotuneAuthenticatedUser,
    Json(request): Json<ImportPlaylistRequest>,
) -> FerrotuneApiResult<Json<ImportPlaylistResponse>> {
    use crate::db::models::MissingEntryData;
    use crate::db::queries::{add_entries_to_playlist, create_playlist, PlaylistEntry};

    /// Build search text from missing entry fields in "artist - album - title" format
    fn build_missing_search_text(
        artist: Option<&str>,
        album: Option<&str>,
        title: Option<&str>,
        raw: &str,
    ) -> String {
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
    create_playlist(
        &state.database,
        &playlist_id,
        &request.name,
        user.user_id,
        request.comment.as_deref(),
        false,
        request.folder_id.as_deref(),
    )
    .await?;
    let mut matched_count = 0i32;
    let mut missing_count = 0i32;

    let entries: Vec<PlaylistEntry> = request
        .entries
        .into_iter()
        .filter_map(|entry| {
            // Parse missing data if present (used for refine match later)
            let missing_data = entry.missing.map(|m| {
                let search_text = build_missing_search_text(
                    m.artist.as_deref(),
                    m.album.as_deref(),
                    m.title.as_deref(),
                    &m.raw,
                );
                (
                    MissingEntryData {
                        title: m.title,
                        artist: m.artist,
                        album: m.album,
                        duration: m.duration,
                        raw: m.raw,
                    },
                    search_text,
                )
            });

            if let Some(song_id) = entry.song_id {
                matched_count += 1;
                // Store missing data even for matched tracks so they can be refined later
                Some(PlaylistEntry {
                    song_id: Some(song_id),
                    missing_entry_data: missing_data.as_ref().map(|(d, _)| d.clone()),
                    // Don't store search text for matched entries (not needed for filtering)
                    missing_search_text: None,
                })
            } else if let Some((data, search_text)) = missing_data {
                missing_count += 1;
                Some(PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(data),
                    missing_search_text: Some(search_text),
                })
            } else {
                // Skip empty entries
                None
            }
        })
        .collect();

    // Add entries to the playlist
    add_entries_to_playlist(&state.database, &playlist_id, &entries).await?;

    Ok(Json(ImportPlaylistResponse {
        playlist_id,
        matched_count,
        missing_count,
    }))
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
    /// Filter by entry type: "song", "missing", or omit for both
    #[serde(default)]
    pub entry_type: Option<String>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(flatten)]
    pub inline_images: InlineImagesParam,
}

/// A unified playlist entry - either a song or a missing entry
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistSongEntry {
    /// Unique identifier for this playlist entry (stable across reordering)
    pub entry_id: String,
    /// Position in the playlist (0-indexed, from original playlist order)
    pub position: i32,
    /// Type of entry: "song" or "missing"
    pub entry_type: String,
    /// When the entry was added to the playlist (ISO 8601 format)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_to_playlist: Option<String>,
    /// Index among songs only (excluding missing entries) in the current filtered/sorted view.
    /// This maps directly to the queue index when playing from this playlist.
    /// Only present for song entries, not for missing entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song_index: Option<i32>,
    /// Song data (only present if entry_type is "song")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song: Option<crate::api::common::models::SongResponse>,
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
    /// Whether this playlist was shared with the current user
    #[serde(default)]
    pub shared_with_me: bool,
    /// Whether the current user can edit this playlist
    #[serde(default)]
    pub can_edit: bool,
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
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<GetPlaylistSongsParams>,
) -> FerrotuneApiResult<Json<PlaylistSongsResponse>> {
    use crate::api::common::browse::song_to_response_with_stats;
    use crate::api::common::playlist_access::get_playlist_access;
    use crate::db::models::MissingEntryData;

    // Get playlist metadata
    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    // Check access using shared helper
    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_read {
        return Err(Error::Forbidden("Not authorized to access this playlist".to_string()).into());
    }

    // Get all playlist entries (positions, song_ids, missing data, added_at, entry_id)
    #[derive(sea_orm::FromQueryResult)]
    struct EntryRaw {
        position: i64,
        song_id: Option<String>,
        missing_entry_data: Option<String>,
        missing_search_text: Option<String>,
        added_at: DateTime<Utc>,
        entry_id: Option<String>,
    }
    let entries_raw: Vec<EntryRaw> =
        crate::db::repo::playlists::list_playlist_entries_full(&state.database, &playlist_id)
            .await?
            .into_iter()
            .map(|r| EntryRaw {
                position: r.position,
                song_id: r.song_id,
                missing_entry_data: r.missing_entry_data,
                missing_search_text: r.missing_search_text,
                added_at: r.added_at,
                entry_id: r.entry_id,
            })
            .collect();

    // Count totals
    let total_entries = entries_raw.len() as i64;
    let matched_count = entries_raw.iter().filter(|e| e.song_id.is_some()).count() as i64;
    // Only count as "missing" if there's no song_id (truly unmatched entries)
    let missing_count = entries_raw
        .iter()
        .filter(|e| e.song_id.is_none() && e.missing_entry_data.is_some())
        .count() as i64;

    // Get all song IDs that are not null
    let song_ids: Vec<String> = entries_raw
        .iter()
        .filter_map(|e| e.song_id.clone())
        .collect();

    // Fetch all songs at once with their library enabled status
    let songs = if !song_ids.is_empty() {
        crate::db::repo::browse::get_songs_by_ids_with_library_status(
            &state.database,
            &song_ids,
            user.user_id,
        )
        .await?
    } else {
        vec![]
    };

    // Create a lookup map from song_id -> SongWithLibraryStatus
    let song_map: std::collections::HashMap<String, crate::db::models::SongWithLibraryStatus> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();

    // Determine sort mode
    let sort_field = params.sort.as_deref().unwrap_or("custom");
    let sort_dir = params.sort_dir.as_deref().unwrap_or("asc");
    let filter_text = params.filter.as_deref();
    let has_filter = filter_text.map(|f| !f.trim().is_empty()).unwrap_or(false);
    let is_custom_sort = sort_field == "custom";

    // Build unified entry list with position info
    #[derive(Clone)]
    #[allow(clippy::large_enum_variant)]
    enum EntryData {
        Song {
            position: i64,
            song: crate::db::models::Song,
            missing_data: Option<MissingEntryData>,
            added_at: Option<String>,
            entry_id: String,
        },
        Missing {
            position: i64,
            data: MissingEntryData,
            added_at: Option<String>,
            entry_id: String,
        },
        /// A song from a disabled library - we have full song data but it can't be played
        DisabledLibrary {
            position: i64,
            song: crate::db::models::Song,
            missing_data: Option<MissingEntryData>,
            added_at: Option<String>,
            entry_id: String,
        },
        /// A song that has a song_id but the song is truly not found (deleted from DB)
        NotFound {
            position: i64,
            song_id: String,
            missing_data: Option<MissingEntryData>,
            added_at: Option<String>,
            entry_id: String,
        },
    }

    let mut unified_entries: Vec<EntryData> = entries_raw
        .into_iter()
        .filter_map(
            |EntryRaw {
                 position,
                 song_id,
                 missing_entry_data: missing_json,
                 missing_search_text: _missing_search_text,
                 added_at,
                 entry_id,
             }| {
                // Parse missing data if present
                let missing_data = missing_json
                    .as_ref()
                    .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok());
                let added_at = Some(format_datetime_iso(added_at));

                // Generate a fallback entry_id if missing (for legacy entries)
                let entry_id = entry_id.unwrap_or_else(|| format!("legacy-{}", position));

                if let Some(sid) = song_id {
                    // Try to find the song in the map
                    if let Some(song_with_status) = song_map.get(&sid) {
                        let song = song_with_status.clone().into_song();
                        if song_with_status.library_enabled {
                            // Song from enabled library - playable
                            Some(EntryData::Song {
                                position,
                                song,
                                missing_data,
                                added_at: added_at.clone(),
                                entry_id,
                            })
                        } else {
                            // Song from disabled library - show metadata but not playable
                            Some(EntryData::DisabledLibrary {
                                position,
                                song,
                                missing_data,
                                added_at: added_at.clone(),
                                entry_id,
                            })
                        }
                    } else {
                        // Song ID exists but song not found in DB at all (truly deleted)
                        Some(EntryData::NotFound {
                            position,
                            song_id: sid,
                            missing_data,
                            added_at,
                            entry_id,
                        })
                    }
                } else {
                    missing_data.map(|data| EntryData::Missing {
                        position,
                        data,
                        added_at,
                        entry_id,
                    })
                }
            },
        )
        .collect();

    // Apply entry type filter first
    if let Some(ref entry_type_filter) = params.entry_type {
        let filter_type = entry_type_filter.to_lowercase();
        unified_entries.retain(|entry| {
            matches!(
                (&filter_type[..], entry),
                ("song", EntryData::Song { .. }) 
                | ("song", EntryData::DisabledLibrary { .. })  // DisabledLibrary has song data
                | ("missing", EntryData::Missing { .. })
                | ("missing", EntryData::NotFound { .. })  // notFound entries are treated as missing for filtering
                | ("missing", EntryData::DisabledLibrary { .. })  // DisabledLibrary can also be treated as "missing" when looking for unavailable
                | ("notfound", EntryData::NotFound { .. })
                | ("notfound", EntryData::DisabledLibrary { .. })
            )
        });
    }

    // Apply text filtering using the same tokenization logic as FTS search
    if has_filter {
        use crate::api::common::search::text_matches_query;
        let query = filter_text.unwrap();
        unified_entries.retain(|entry| match entry {
            EntryData::Song { song, .. } => {
                // Build combined searchable text from song metadata
                let search_text = format!(
                    "{} {} {}",
                    song.title,
                    song.artist_name,
                    song.album_name.as_deref().unwrap_or("")
                );
                text_matches_query(&search_text, query)
            }
            EntryData::Missing { data, .. } => {
                // Build combined searchable text from missing entry metadata
                let search_text = format!(
                    "{} {} {} {}",
                    data.title.as_deref().unwrap_or(""),
                    data.artist.as_deref().unwrap_or(""),
                    data.album.as_deref().unwrap_or(""),
                    data.raw
                );
                text_matches_query(&search_text, query)
            }
            EntryData::NotFound {
                missing_data,
                song_id,
                ..
            } => {
                // Build searchable text from missing data or song_id
                if let Some(data) = missing_data {
                    let search_text = format!(
                        "{} {} {} {}",
                        data.title.as_deref().unwrap_or(""),
                        data.artist.as_deref().unwrap_or(""),
                        data.album.as_deref().unwrap_or(""),
                        data.raw
                    );
                    text_matches_query(&search_text, query)
                } else {
                    text_matches_query(song_id, query)
                }
            }
            EntryData::DisabledLibrary { song, .. } => {
                // Build combined searchable text from song metadata
                let search_text = format!(
                    "{} {} {}",
                    song.title,
                    song.artist_name,
                    song.album_name.as_deref().unwrap_or("")
                );
                text_matches_query(&search_text, query)
            }
        });
    }

    // Apply sorting
    if !is_custom_sort {
        // When sorting by a specific field, we need to decide how to handle missing/disabled entries.
        // Missing/NotFound/DisabledLibrary entries are excluded when sorting by
        // specific fields. They are only shown in "custom" (playlist order) mode.
        unified_entries.retain(|entry| matches!(entry, EntryData::Song { .. }));

        // Sort songs - need to capture added_at from the entry since it's not on the Song model
        unified_entries.sort_by(|a, b| {
            let (song_a, added_at_a, song_b, added_at_b) = match (a, b) {
                (
                    EntryData::Song {
                        song: sa,
                        added_at: aa,
                        ..
                    },
                    EntryData::Song {
                        song: sb,
                        added_at: ab,
                        ..
                    },
                ) => (sa, aa, sb, ab),
                _ => unreachable!(), // We filtered out missing entries above
            };

            let cmp = match sort_field {
                "name" | "title" => song_a
                    .title
                    .to_lowercase()
                    .cmp(&song_b.title.to_lowercase()),
                "artist" => song_a
                    .artist_name
                    .to_lowercase()
                    .cmp(&song_b.artist_name.to_lowercase()),
                "album" => {
                    let a_album = song_a.album_name.as_deref().unwrap_or("");
                    let b_album = song_b.album_name.as_deref().unwrap_or("");
                    a_album.to_lowercase().cmp(&b_album.to_lowercase())
                }
                "year" => song_a.year.unwrap_or(0).cmp(&song_b.year.unwrap_or(0)),
                "dateAdded" | "created" => song_a.created_at.cmp(&song_b.created_at),
                "addedToPlaylist" => added_at_a.cmp(added_at_b),
                "playCount" => song_a
                    .play_count
                    .unwrap_or(0)
                    .cmp(&song_b.play_count.unwrap_or(0)),
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

    // Compute song indices (index among songs only, excluding missing entries)
    // This is computed before pagination so indices are correct across pages
    let mut song_idx = 0i32;
    let entries_with_song_idx: Vec<_> = unified_entries
        .into_iter()
        .map(|entry| {
            let idx = match &entry {
                EntryData::Song { .. } => {
                    let current = song_idx;
                    song_idx += 1;
                    Some(current)
                }
                EntryData::Missing { .. }
                | EntryData::NotFound { .. }
                | EntryData::DisabledLibrary { .. } => None,
            };
            (entry, idx)
        })
        .collect();

    // Apply pagination
    let offset = params.offset.unwrap_or(0) as usize;
    let count = params.count.unwrap_or(50) as usize;
    let inline_size = params.inline_images.get_size();
    let page_entries: Vec<_> = entries_with_song_idx
        .into_iter()
        .skip(offset)
        .take(count)
        .collect();

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_size {
        // Collect (song_id, album_id) pairs for songs in this page
        let song_thumbnail_data: Vec<(String, Option<String>)> = page_entries
            .iter()
            .filter_map(|(entry, _)| match entry {
                EntryData::Song { song, .. } | EntryData::DisabledLibrary { song, .. } => {
                    Some((song.id.clone(), song.album_id.clone()))
                }
                EntryData::Missing { .. } | EntryData::NotFound { .. } => None,
            })
            .collect();
        get_song_thumbnails_base64(&state.database, &song_thumbnail_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    // Get starred status and ratings for songs in this page
    let page_song_ids: Vec<String> = page_entries
        .iter()
        .filter_map(|(entry, _)| match entry {
            EntryData::Song { song, .. } | EntryData::DisabledLibrary { song, .. } => {
                Some(song.id.clone())
            }
            EntryData::Missing { .. } | EntryData::NotFound { .. } => None,
        })
        .collect();
    let starred_map = get_starred_map(
        &state.database,
        user.user_id,
        ItemType::Song,
        &page_song_ids,
    )
    .await
    .unwrap_or_default();
    let ratings_map = get_ratings_map(
        &state.database,
        user.user_id,
        ItemType::Song,
        &page_song_ids,
    )
    .await
    .unwrap_or_default();

    // Convert to response format
    let entries: Vec<PlaylistSongEntry> = page_entries
        .into_iter()
        .map(|(entry, song_index)| match entry {
            EntryData::Song {
                position,
                song,
                missing_data,
                added_at,
                entry_id,
            } => {
                let cover_art_data = thumbnails.get(&song.id).cloned();
                let starred = starred_map.get(&song.id).cloned();
                let user_rating = ratings_map.get(&song.id).copied();
                let play_stats = SongPlayStats {
                    play_count: song.play_count,
                    last_played: song.last_played.map(format_datetime_iso),
                };
                PlaylistSongEntry {
                    entry_id,
                    position: position as i32,
                    entry_type: "song".to_string(),
                    added_to_playlist: added_at,
                    song_index,
                    song: Some(song_to_response_with_stats(
                        song,
                        None,
                        starred,
                        user_rating,
                        Some(play_stats),
                        None,
                        cover_art_data,
                    )),
                    missing: missing_data.map(|data| MissingEntryDataResponse {
                        title: data.title,
                        artist: data.artist,
                        album: data.album,
                        duration: data.duration,
                        raw: data.raw,
                    }),
                }
            }
            EntryData::Missing {
                position,
                data,
                added_at,
                entry_id,
            } => PlaylistSongEntry {
                entry_id,
                position: position as i32,
                entry_type: "missing".to_string(),
                added_to_playlist: added_at,
                song_index: None,
                song: None,
                missing: Some(MissingEntryDataResponse {
                    title: data.title,
                    artist: data.artist,
                    album: data.album,
                    duration: data.duration,
                    raw: data.raw,
                }),
            },
            EntryData::NotFound {
                position,
                song_id: _,
                missing_data,
                added_at,
                entry_id,
            } => {
                // NotFound entries are songs that were deleted from the database entirely
                PlaylistSongEntry {
                    entry_id,
                    position: position as i32,
                    entry_type: "notFound".to_string(),
                    added_to_playlist: added_at,
                    song_index: None,
                    song: None,
                    missing: missing_data.map(|data| MissingEntryDataResponse {
                        title: data.title,
                        artist: data.artist,
                        album: data.album,
                        duration: data.duration,
                        raw: data.raw,
                    }),
                }
            }
            EntryData::DisabledLibrary {
                position,
                song,
                missing_data,
                added_at,
                entry_id,
            } => {
                // DisabledLibrary entries have full song data but library is disabled
                // We return the song data so the UI can show title/artist/album
                let cover_art_data = thumbnails.get(&song.id).cloned();
                let starred = starred_map.get(&song.id).cloned();
                let user_rating = ratings_map.get(&song.id).copied();
                let play_stats = SongPlayStats {
                    play_count: song.play_count,
                    last_played: song.last_played.map(format_datetime_iso),
                };
                PlaylistSongEntry {
                    entry_id,
                    position: position as i32,
                    entry_type: "notFound".to_string(), // UI treats as not found but has song data
                    added_to_playlist: added_at,
                    song_index: None,
                    song: Some(song_to_response_with_stats(
                        song,
                        None,
                        starred,
                        user_rating,
                        Some(play_stats),
                        None,
                        cover_art_data,
                    )),
                    missing: missing_data.map(|data| MissingEntryDataResponse {
                        title: data.title,
                        artist: data.artist,
                        album: data.album,
                        duration: data.duration,
                        raw: data.raw,
                    }),
                }
            }
        })
        .collect();

    // Build cover art reference
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    // Get owner username for shared playlists
    let owner_name = if access.is_owner {
        user.username.clone()
    } else {
        username_for_user(&state.database, playlist.owner_id).await?
    };

    Ok(Json(PlaylistSongsResponse {
        id: playlist.id,
        name: playlist.name,
        comment: playlist.comment,
        owner: owner_name,
        public: playlist.is_public,
        total_entries,
        matched_count,
        missing_count,
        duration: playlist.duration,
        filtered_count,
        created: format_datetime_iso_ms(playlist.created_at),
        changed: format_datetime_iso_ms(playlist.updated_at),
        cover_art,
        shared_with_me: !access.is_owner,
        can_edit: access.can_edit,
        entries,
    }))
}

/// Request to update a playlist's metadata.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdatePlaylistRequest {
    pub name: Option<String>,
    pub comment: Option<String>,
    pub public: Option<bool>,
}

// ============================================================================
// Playlist sharing types and endpoints
// ============================================================================

/// A single playlist share entry in the response.
#[derive(Debug, Serialize, sea_orm::FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistShareResponse {
    #[ts(type = "number")]
    pub user_id: i64,
    pub username: String,
    pub can_edit: bool,
}

/// Response containing all shares for a playlist.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistSharesResponse {
    pub shares: Vec<PlaylistShareResponse>,
}

/// A single share entry in the set-shares request.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShareEntry {
    #[ts(type = "number")]
    pub user_id: i64,
    pub can_edit: bool,
}

/// Request to set all shares for a playlist (replace-all semantics).
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SetPlaylistSharesRequest {
    pub shares: Vec<ShareEntry>,
}

/// GET /ferrotune/playlists/{id}/shares - Get all shares for a playlist (owner only).
pub async fn get_playlist_shares(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
) -> FerrotuneApiResult<Json<PlaylistSharesResponse>> {
    let Some(owner_id) = playlist_owner_id(&state.database, &playlist_id).await? else {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    };

    if owner_id != user.user_id {
        return Err(Error::Forbidden(
            "Not authorized to manage shares for this playlist".to_string(),
        )
        .into());
    }

    let shares = fetch_playlist_shares(&state.database, &playlist_id).await?;

    Ok(Json(PlaylistSharesResponse { shares }))
}

/// PUT /ferrotune/playlists/{id}/shares - Set all shares for a playlist (owner only).
pub async fn set_playlist_shares(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<SetPlaylistSharesRequest>,
) -> FerrotuneApiResult<Json<PlaylistSharesResponse>> {
    let Some(owner_id) = playlist_owner_id(&state.database, &playlist_id).await? else {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    };

    if owner_id != user.user_id {
        return Err(Error::Forbidden(
            "Not authorized to manage shares for this playlist".to_string(),
        )
        .into());
    }

    // Cannot share with yourself
    if request.shares.iter().any(|s| s.user_id == user.user_id) {
        return Err(
            Error::InvalidRequest("Cannot share a playlist with yourself".to_string()).into(),
        );
    }

    // Validate all user IDs exist
    for share in &request.shares {
        if !user_exists(&state.database, share.user_id).await? {
            return Err(
                Error::InvalidRequest(format!("User with id {} not found", share.user_id)).into(),
            );
        }
    }

    let share_inputs = request
        .shares
        .iter()
        .map(|share| playlists_repo::PlaylistShareInput {
            user_id: share.user_id,
            can_edit: share.can_edit,
        })
        .collect::<Vec<_>>();

    playlists_repo::replace_playlist_shares(&state.database, &playlist_id, &share_inputs).await?;

    let shares = fetch_playlist_shares(&state.database, &playlist_id).await?;

    Ok(Json(PlaylistSharesResponse { shares }))
}

/// Update a playlist's metadata.
pub async fn update_playlist(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<UpdatePlaylistRequest>,
) -> FerrotuneApiResult<Json<PlaylistSongsResponse>> {
    use crate::api::common::playlist_access::get_playlist_access;

    // Check playlist exists
    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::Forbidden("Not authorized to update this playlist".to_string()).into());
    }

    if request.name.is_some() || request.comment.is_some() || request.public.is_some() {
        crate::db::queries::update_playlist_metadata(
            &state.database,
            &playlist_id,
            request.name.as_deref(),
            request.comment.as_deref(),
            request.public,
        )
        .await?;
    }

    // Query the updated playlist and return it.
    let updated_playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    // Get owner username for shared playlists
    let owner_name = if access.is_owner {
        user.username.clone()
    } else {
        username_for_user(&state.database, updated_playlist.owner_id).await?
    };

    Ok(Json(PlaylistSongsResponse {
        id: updated_playlist.id.clone(),
        name: updated_playlist.name,
        comment: updated_playlist.comment,
        owner: owner_name,
        public: updated_playlist.is_public,
        total_entries: updated_playlist.song_count,
        matched_count: 0, // Approximate/not calculated here
        missing_count: 0, // Approximate/not calculated here
        duration: updated_playlist.duration,
        filtered_count: 0,
        created: format_datetime_iso_ms(updated_playlist.created_at),
        changed: format_datetime_iso_ms(updated_playlist.updated_at),
        cover_art: if updated_playlist.song_count > 0 {
            Some(updated_playlist.id.clone())
        } else {
            None
        },
        shared_with_me: !access.is_owner,
        can_edit: access.can_edit,
        entries: vec![], // Return empty entries to signal only metadata update
    }))
}

// ============================================================================
// Playlist ownership transfer
// ============================================================================

/// Request to transfer playlist ownership.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TransferPlaylistOwnershipRequest {
    /// The user ID of the new owner
    #[ts(type = "number")]
    pub new_owner_id: i64,
}

/// Transfer ownership of a playlist to another user.
/// Only the current owner can transfer ownership.
pub async fn transfer_playlist_ownership(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<TransferPlaylistOwnershipRequest>,
) -> FerrotuneApiResult<StatusCode> {
    // Get playlist and verify current user is the owner
    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    if playlist.owner_id != user.user_id {
        return Err(
            Error::Forbidden("Only the playlist owner can transfer ownership".to_string()).into(),
        );
    }

    // Verify the new owner exists
    if !user_exists(&state.database, request.new_owner_id).await? {
        return Err(Error::NotFound("Target user not found".to_string()).into());
    }

    if request.new_owner_id == user.user_id {
        return Err(
            Error::InvalidRequest("Cannot transfer ownership to yourself".to_string()).into(),
        );
    }

    // Transfer ownership
    crate::db::repo::playlists::transfer_playlist_ownership(
        &state.database,
        &playlist_id,
        request.new_owner_id,
    )
    .await?;

    // Remove any existing share entries for the new owner (since they're now the owner)
    crate::db::repo::playlists::remove_playlist_share(
        &state.database,
        &playlist_id,
        request.new_owner_id,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Delete a playlist.
pub async fn delete_playlist(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    // Check playlist exists and belongs to user
    let Some(owner_id) = playlist_owner_id(&state.database, &playlist_id).await? else {
        return Err(Error::NotFound("Playlist not found".to_string()).into());
    };

    if owner_id != user.user_id {
        return Err(Error::Forbidden("Not authorized to delete this playlist".to_string()).into());
    }

    // Delete the playlist (cascade should handle entries)
    crate::db::queries::delete_playlist(&state.database, &playlist_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to add songs to a playlist.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AddPlaylistSongsRequest {
    pub song_ids: Vec<String>,
}

/// Add songs to a playlist.
pub async fn add_playlist_songs(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<AddPlaylistSongsRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;
    use crate::db::queries::{add_entries_to_playlist, PlaylistEntry};

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::Forbidden("Not authorized to modify this playlist".to_string()).into());
    }

    if request.song_ids.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Convert to PlaylistEntry
    let entries: Vec<PlaylistEntry> = request
        .song_ids
        .iter()
        .map(|id| PlaylistEntry {
            song_id: Some(id.clone()),
            missing_entry_data: None,
            missing_search_text: None,
        })
        .collect();

    add_entries_to_playlist(&state.database, &playlist_id, &entries).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Request to remove songs from a playlist by index.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RemovePlaylistSongsRequest {
    pub indexes: Vec<i32>,
}

/// Remove songs from a playlist by index.
pub async fn remove_playlist_songs(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Path(playlist_id): Path<String>,
    Json(request): Json<RemovePlaylistSongsRequest>,
) -> FerrotuneApiResult<StatusCode> {
    use crate::api::common::playlist_access::get_playlist_access;

    let playlist = crate::db::queries::get_playlist_by_id(&state.database, &playlist_id)
        .await?
        .ok_or_else(|| Error::NotFound("Playlist not found".to_string()))?;

    let access = get_playlist_access(
        &state.database,
        user.user_id,
        playlist.owner_id,
        &playlist_id,
        playlist.is_public,
    )
    .await?;

    if !access.can_edit {
        return Err(Error::Forbidden("Not authorized to modify this playlist".to_string()).into());
    }

    if request.indexes.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }

    if request.indexes.iter().any(|index| *index < 0) {
        return Err(Error::InvalidRequest("Invalid position".to_string()).into());
    }

    let indexes: Vec<u32> = request
        .indexes
        .into_iter()
        .map(|index| index as u32)
        .collect();
    crate::db::queries::remove_songs_by_position(&state.database, &playlist_id, &indexes).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Song containment endpoint - which playlists contain these songs?
// ============================================================================

/// Query parameters for getting playlists containing songs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPlaylistsQuery {
    /// Song IDs to check
    #[serde(
        rename = "songId",
        deserialize_with = "crate::api::subsonic::query::string_or_seq"
    )]
    pub song_ids: Vec<String>,
}

/// Information about a playlist containing a song
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistContainingSong {
    pub playlist_id: String,
    pub playlist_name: String,
}

/// Response with playlists that contain the requested songs
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongPlaylistsResponse {
    /// Map of song_id to list of playlists containing that song
    pub playlists_by_song: std::collections::HashMap<String, Vec<PlaylistContainingSong>>,
}

/// Get playlists that contain the specified songs
pub async fn get_playlists_for_songs(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    QsQuery(params): QsQuery<SongPlaylistsQuery>,
) -> FerrotuneApiResult<Json<SongPlaylistsResponse>> {
    use std::collections::HashMap;

    if params.song_ids.is_empty() {
        return Ok(Json(SongPlaylistsResponse {
            playlists_by_song: HashMap::new(),
        }));
    }

    let rows = crate::db::repo::playlists::list_owner_playlists_containing_songs(
        &state.database,
        user.user_id,
        &params.song_ids,
    )
    .await?;

    // Group by song_id
    let mut playlists_by_song: HashMap<String, Vec<PlaylistContainingSong>> = HashMap::new();
    for crate::db::repo::playlists::SongPlaylistRow {
        song_id,
        playlist_id,
        playlist_name,
    } in rows
    {
        playlists_by_song
            .entry(song_id)
            .or_default()
            .push(PlaylistContainingSong {
                playlist_id,
                playlist_name,
            });
    }

    Ok(Json(SongPlaylistsResponse { playlists_by_song }))
}

/// A recently played playlist (regular or smart).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RecentPlaylistEntry {
    pub id: String,
    pub name: String,
    /// "playlist" or "smartPlaylist"
    pub playlist_type: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    pub last_played_at: String,
    pub cover_art: Option<String>,
}

/// Response for recently played playlists.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RecentPlaylistsResponse {
    pub playlists: Vec<RecentPlaylistEntry>,
}

/// GET /ferrotune/playlists/recently-played - Get recently played playlists
pub async fn get_recently_played_playlists(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
) -> FerrotuneApiResult<Json<RecentPlaylistsResponse>> {
    use crate::api::common::utils::format_datetime_iso;

    let regular =
        crate::db::repo::playlists::list_recent_regular_playlists(&state.database, user.user_id)
            .await?;

    let smart =
        crate::db::repo::playlists::list_recent_smart_playlists(&state.database, user.user_id)
            .await?;

    let mut entries: Vec<RecentPlaylistEntry> = Vec::new();

    for row in regular {
        entries.push(RecentPlaylistEntry {
            cover_art: Some(row.id.clone()),
            id: row.id,
            name: row.name,
            playlist_type: "playlist".to_string(),
            song_count: row.song_count,
            duration: row.duration,
            last_played_at: format_datetime_iso(row.last_played_at),
        });
    }

    for row in smart {
        entries.push(RecentPlaylistEntry {
            cover_art: Some(format!("sp-{}", row.id)),
            playlist_type: "smartPlaylist".to_string(),
            id: row.id,
            name: row.name,
            song_count: 0, // Smart playlists compute this dynamically
            duration: 0,
            last_played_at: format_datetime_iso(row.last_played_at),
        });
    }

    // Sort by last_played_at descending (most recent first)
    entries.sort_by(|a, b| b.last_played_at.cmp(&a.last_played_at));
    entries.truncate(50);

    Ok(Json(RecentPlaylistsResponse { playlists: entries }))
}
