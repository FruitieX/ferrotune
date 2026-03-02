use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::{FormatEmptyResponse, FormatResponse};
use crate::api::AppState;
use crate::api::QsQuery;
use crate::api::{first_string, first_string_or_none, string_or_seq};
use crate::db::models::{ItemType, Playlist};
use crate::db::queries::{self, resolve_or_create_folder_path};
use crate::error::{Error, Result};
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    id: Option<String>,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    filter: Option<String>,
    /// Offset for pagination (number of songs to skip)
    #[serde(
        default,
        deserialize_with = "crate::api::subsonic::query::first_u32_or_none"
    )]
    offset: Option<u32>,
    /// Number of songs to return (for pagination)
    #[serde(
        default,
        deserialize_with = "crate::api::subsonic::query::first_u32_or_none"
    )]
    count: Option<u32>,
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
    /// Total songs after filtering (before pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub song_total: Option<i64>,
    pub entry: Vec<crate::api::common::models::SongResponse>,
}

/// Convert a database Playlist to a PlaylistResponse.
/// `full_name` should be the playlist name with folder path prefix (e.g., "Folder/SubFolder/PlaylistName").
fn playlist_to_response(
    playlist: &Playlist,
    owner_name: &str,
    full_name: String,
) -> PlaylistResponse {
    // Use playlist ID as cover art reference (will generate tiled cover)
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    PlaylistResponse {
        id: playlist.id.clone(),
        name: full_name,
        comment: playlist.comment.clone(),
        owner: owner_name.to_string(),
        public: playlist.is_public,
        song_count: playlist.song_count,
        duration: playlist.duration,
        created: format_datetime_iso_ms(playlist.created_at),
        changed: format_datetime_iso_ms(playlist.updated_at),
        cover_art,
    }
}

/// Convert a Song to SongResponse with starred and rating info for playlist context
fn song_to_playlist_response(
    song: &crate::db::models::Song,
    starred_map: &HashMap<String, String>,
    ratings_map: &HashMap<String, i32>,
) -> crate::api::common::models::SongResponse {
    crate::api::common::browse::song_to_response(
        song.clone(),
        None,
        starred_map.get(&song.id).cloned(),
        ratings_map.get(&song.id).copied(),
    )
}

/// GET /rest/getPlaylists - Get all playlists
pub async fn get_playlists(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<FormatResponse<PlaylistsResponse>> {
    let playlists = queries::get_playlists_for_user(&state.pool, user.user_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    // Build full names (with folder paths) for all playlists
    let mut playlist_responses = Vec::with_capacity(playlists.len());
    for p in &playlists {
        let full_name =
            queries::get_playlist_full_name(&state.pool, &p.name, p.folder_id.as_deref())
                .await
                .map_err(|e| Error::Internal(e.to_string()))?;
        playlist_responses.push(playlist_to_response(p, &user.username, full_name));
    }

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
    use crate::api::common::sorting::filter_and_sort_songs;

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
    let songs = queries::get_playlist_songs(&state.pool, &id, user.user_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get total after filtering for pagination
    let total_after_filter = songs.len() as i64;

    // Apply pagination if offset/count provided
    let songs = if let (Some(offset), Some(count)) = (params.offset, params.count) {
        songs
            .into_iter()
            .skip(offset as usize)
            .take(count as usize)
            .collect()
    } else {
        songs
    };

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    let song_responses: Vec<crate::api::common::models::SongResponse> = songs
        .iter()
        .map(|song| song_to_playlist_response(song, &starred_map, &ratings_map))
        .collect();

    // Use playlist ID as cover art reference
    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    // Get full name with folder path
    let full_name =
        queries::get_playlist_full_name(&state.pool, &playlist.name, playlist.folder_id.as_deref())
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;

    let response = PlaylistWithSongsResponse {
        playlist: PlaylistDetailResponse {
            id: playlist.id.clone(),
            name: full_name,
            comment: playlist.comment.clone(),
            owner: user.username.clone(),
            public: playlist.is_public,
            song_count: playlist.song_count,
            duration: playlist.duration,
            created: format_datetime_iso_ms(playlist.created_at),
            changed: format_datetime_iso_ms(playlist.updated_at),
            cover_art,
            song_total: Some(total_after_filter),
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

    // Create the playlist (OpenSubsonic API - goes to root, or parse path from name)
    // Parse name to extract folder path if it contains "/"
    let (folder_id, final_name) = if name.contains('/') {
        // Parse the path and create folders
        let path_result = resolve_or_create_folder_path(&state.pool, &name, user.user_id).await;
        match path_result {
            Ok((folder_id, playlist_name)) => (folder_id, playlist_name),
            Err(_) => (None, name.clone()), // Fall back to using full name at root
        }
    } else {
        (None, name.clone())
    };

    queries::create_playlist(
        &state.pool,
        &playlist_id,
        &final_name,
        user.user_id,
        None,
        false,
        folder_id.as_deref(),
    )
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

    let songs = queries::get_playlist_songs(&state.pool, playlist_id, user.user_id)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids)
        .await
        .map_err(|e| Error::Internal(e.to_string()))?;

    let song_responses: Vec<crate::api::common::models::SongResponse> = songs
        .iter()
        .map(|song| song_to_playlist_response(song, &starred_map, &ratings_map))
        .collect();

    let cover_art = if playlist.song_count > 0 {
        Some(playlist.id.clone())
    } else {
        None
    };

    // Get full name with folder path
    let full_name =
        queries::get_playlist_full_name(&state.pool, &playlist.name, playlist.folder_id.as_deref())
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;

    let response = PlaylistWithSongsResponse {
        playlist: PlaylistDetailResponse {
            id: playlist.id.clone(),
            name: full_name,
            comment: playlist.comment.clone(),
            owner: user.username.clone(),
            public: playlist.is_public,
            song_count: playlist.song_count,
            duration: playlist.duration,
            created: format_datetime_iso_ms(playlist.created_at),
            changed: format_datetime_iso_ms(playlist.updated_at),
            cover_art,
            song_total: None, // Not used in create_playlist
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
