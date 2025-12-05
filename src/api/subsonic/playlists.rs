use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::{FormatEmptyResponse, FormatResponse};
use crate::api::AppState;
use crate::api::QsQuery;
use crate::api::{first_string, first_string_or_none, string_or_seq};
use crate::db::models::Playlist;
use crate::db::queries;
use crate::error::{Error, Result};
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlaylistParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    playlist_id: Option<String>,
    #[serde(default, deserialize_with = "first_string_or_none")]
    name: Option<String>,
    #[serde(default, deserialize_with = "string_or_seq")]
    song_id: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaylistParams {
    #[serde(deserialize_with = "first_string")]
    playlist_id: String,
    #[serde(default, deserialize_with = "first_string_or_none")]
    name: Option<String>,
    #[serde(default, deserialize_with = "first_string_or_none")]
    comment: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::api::subsonic::query::first_bool_or_none"
    )]
    public: Option<bool>,
    #[serde(default, deserialize_with = "string_or_seq")]
    song_id_to_add: Vec<String>,
    #[serde(default, deserialize_with = "crate::api::subsonic::query::u32_or_seq")]
    song_index_to_remove: Vec<u32>,
}

// Response types
#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistsResponse {
    pub playlists: PlaylistsWrapper,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistsWrapper {
    pub playlist: Vec<PlaylistResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub owner: String,
    pub public: bool,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    pub created: String,
    pub changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistWithSongsResponse {
    pub playlist: PlaylistDetailResponse,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlaylistDetailResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub owner: String,
    pub public: bool,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    pub created: String,
    pub changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    pub entry: Vec<crate::api::subsonic::browse::SongResponse>,
}

/// Convert a database Playlist to a PlaylistResponse
fn playlist_to_response(playlist: &Playlist, owner_name: &str) -> PlaylistResponse {
    // Use playlist ID as cover art reference (will generate tiled cover)
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    PlaylistResponse {
        id: playlist.id.clone(),
        name: playlist.name.clone(),
        comment: playlist.comment.clone(),
        owner: owner_name.to_string(),
        public: playlist.is_public,
        song_count: playlist.song_count,
        duration: playlist.duration,
        created: playlist
            .created_at
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        changed: playlist
            .updated_at
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        cover_art,
    }
}

/// Convert a Song to SongResponse with defaults for playlist context
fn song_to_playlist_response(
    song: &crate::db::models::Song,
) -> crate::api::subsonic::browse::SongResponse {
    crate::api::subsonic::browse::song_to_response(song.clone(), None, None, None)
}

/// GET /rest/getPlaylists - Get all playlists
pub async fn get_playlists(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<FormatResponse<PlaylistsResponse>> {
    let playlists = queries::get_playlists_for_user(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    let playlist_responses: Vec<PlaylistResponse> = playlists
        .iter()
        .map(|p| playlist_to_response(p, &user.username))
        .collect();

    let response = PlaylistsResponse {
        playlists: PlaylistsWrapper {
            playlist: playlist_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/getPlaylist - Get a specific playlist
pub async fn get_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<PlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse>> {
    let id = params
        .id
        .ok_or_else(|| Error::InvalidRequest("Missing required parameter: id".to_string()))?;

    let playlist = queries::get_playlist_by_id(&state.pool, &id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?
        .ok_or_else(|| Error::NotFound(format!("Playlist not found: {}", id)))?;

    // Check access: user must own playlist or it must be public
    if playlist.owner_id != user.user_id && !playlist.is_public {
        return Err(Error::Forbidden(
            "Not authorized to access this playlist".to_string(),
        ));
    }

    // Get songs in the playlist
    let songs = queries::get_playlist_songs(&state.pool, &id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    let song_responses: Vec<crate::api::subsonic::browse::SongResponse> =
        songs.iter().map(song_to_playlist_response).collect();

    // Use playlist ID as cover art reference
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    let response = PlaylistWithSongsResponse {
        playlist: PlaylistDetailResponse {
            id: playlist.id.clone(),
            name: playlist.name.clone(),
            comment: playlist.comment.clone(),
            owner: user.username.clone(),
            public: playlist.is_public,
            song_count: playlist.song_count,
            duration: playlist.duration,
            created: playlist
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            changed: playlist
                .updated_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            cover_art,
            entry: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/createPlaylist - Create or update a playlist
pub async fn create_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    QsQuery(params): QsQuery<CreatePlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse>> {
    // If playlistId is provided, update existing playlist
    if let Some(ref playlist_id) = params.playlist_id {
        // Get existing playlist
        let playlist = queries::get_playlist_by_id(&state.pool, playlist_id)
            .await
            .map_err(|e| Error::Internal(e.to_string()))?
            .ok_or_else(|| Error::NotFound(format!("Playlist not found: {}", playlist_id)))?;

        // Check ownership
        if playlist.owner_id != user.user_id {
            return Err(Error::Forbidden(
                "Not authorized to modify this playlist".to_string(),
            ));
        }

        // Update name if provided
        if let Some(ref name) = params.name {
            queries::update_playlist_metadata(&state.pool, playlist_id, Some(name), None, None)
                .await
                .map_err(|e| Error::Internal(e.to_string()))?;
        }

        // Add songs if provided
        if !params.song_id.is_empty() {
            queries::add_songs_to_playlist(&state.pool, playlist_id, &params.song_id)
                .await
                .map_err(|e| Error::Internal(e.to_string()))?;
        }

        // Return updated playlist
        return get_playlist_response(&state, &user, playlist_id).await;
    }

    // Creating new playlist - name is required
    let name = params
        .name
        .ok_or_else(|| Error::InvalidRequest("Missing required parameter: name".to_string()))?;

    // Generate playlist ID
    let playlist_id = format!("pl-{}", Uuid::new_v4());

    // Create the playlist
    queries::create_playlist(&state.pool, &playlist_id, &name, user.user_id, None, false)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    // Add songs if provided
    if !params.song_id.is_empty() {
        queries::add_songs_to_playlist(&state.pool, &playlist_id, &params.song_id)
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;
    }

    // Return the new playlist
    get_playlist_response(&state, &user, &playlist_id).await
}

/// Helper to get playlist response (used by create and update)
async fn get_playlist_response(
    state: &AppState,
    user: &AuthenticatedUser,
    playlist_id: &str,
) -> Result<FormatResponse<PlaylistWithSongsResponse>> {
    let playlist = queries::get_playlist_by_id(&state.pool, playlist_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?
        .ok_or_else(|| Error::NotFound(format!("Playlist not found: {}", playlist_id)))?;

    let songs = queries::get_playlist_songs(&state.pool, playlist_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    let song_responses: Vec<crate::api::subsonic::browse::SongResponse> =
        songs.iter().map(song_to_playlist_response).collect();

    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    let response = PlaylistWithSongsResponse {
        playlist: PlaylistDetailResponse {
            id: playlist.id.clone(),
            name: playlist.name.clone(),
            comment: playlist.comment.clone(),
            owner: user.username.clone(),
            public: playlist.is_public,
            song_count: playlist.song_count,
            duration: playlist.duration,
            created: playlist
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            changed: playlist
                .updated_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            cover_art,
            entry: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/updatePlaylist - Update a playlist
pub async fn update_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    QsQuery(params): QsQuery<UpdatePlaylistParams>,
) -> Result<FormatEmptyResponse> {
    let playlist_id = &params.playlist_id;

    // Get existing playlist
    let playlist = queries::get_playlist_by_id(&state.pool, playlist_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?
        .ok_or_else(|| Error::NotFound(format!("Playlist not found: {}", playlist_id)))?;

    // Check ownership
    if playlist.owner_id != user.user_id {
        return Err(Error::Forbidden(
            "Not authorized to modify this playlist".to_string(),
        ));
    }

    // Update metadata if any fields provided
    if params.name.is_some() || params.comment.is_some() || params.public.is_some() {
        queries::update_playlist_metadata(
            &state.pool,
            playlist_id,
            params.name.as_deref(),
            params.comment.as_deref(),
            params.public,
        )
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;
    }

    // Remove songs first (indices are based on current state)
    if !params.song_index_to_remove.is_empty() {
        queries::remove_songs_by_position(&state.pool, playlist_id, &params.song_index_to_remove)
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;
    }

    // Then add new songs
    if !params.song_id_to_add.is_empty() {
        queries::add_songs_to_playlist(&state.pool, playlist_id, &params.song_id_to_add)
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;
    }

    Ok(FormatEmptyResponse::new(user.format))
}

/// GET /rest/deletePlaylist - Delete a playlist
pub async fn delete_playlist(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<PlaylistParams>,
) -> Result<FormatEmptyResponse> {
    let id = params
        .id
        .ok_or_else(|| Error::InvalidRequest("Missing required parameter: id".to_string()))?;

    // Get existing playlist
    let playlist = queries::get_playlist_by_id(&state.pool, &id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?
        .ok_or_else(|| Error::NotFound(format!("Playlist not found: {}", id)))?;

    // Check ownership
    if playlist.owner_id != user.user_id {
        return Err(Error::Forbidden(
            "Not authorized to delete this playlist".to_string(),
        ));
    }

    // Delete the playlist
    queries::delete_playlist(&state.pool, &id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    Ok(FormatEmptyResponse::new(user.format))
}
