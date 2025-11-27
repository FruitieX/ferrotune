use crate::api::auth::AuthenticatedUser;
use crate::api::response::{FormatEmptyResponse, FormatResponse};
use crate::api::QsQuery;
use crate::api::{first_string, first_string_or_none, string_or_seq};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
    #[serde(default, deserialize_with = "crate::api::query::first_bool_or_none")]
    public: Option<bool>,
    #[serde(default, deserialize_with = "string_or_seq")]
    song_id_to_add: Vec<String>,
    #[serde(default, deserialize_with = "crate::api::query::u32_or_seq")]
    song_index_to_remove: Vec<u32>,
}

// Response types
#[derive(Serialize)]
pub struct PlaylistsResponse {
    pub playlists: PlaylistsWrapper,
}

#[derive(Serialize)]
pub struct PlaylistsWrapper {
    pub playlist: Vec<PlaylistResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub owner: String,
    pub public: bool,
    pub song_count: i64,
    pub duration: i64,
    pub created: String,
    pub changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
}

#[derive(Serialize)]
pub struct PlaylistWithSongsResponse {
    pub playlist: PlaylistDetailResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetailResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub owner: String,
    pub public: bool,
    pub song_count: i64,
    pub duration: i64,
    pub created: String,
    pub changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    pub entry: Vec<crate::api::browse::SongResponse>,
}

/// GET /rest/getPlaylists - Get all playlists
pub async fn get_playlists(
    State(_state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<FormatResponse<PlaylistsResponse>> {
    // Return empty playlists for now
    let response = PlaylistsResponse {
        playlists: PlaylistsWrapper { playlist: vec![] },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/getPlaylist - Get a specific playlist
pub async fn get_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<PlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse>> {
    let id = params.id.ok_or_else(|| {
        crate::error::Error::InvalidRequest("Missing required parameter: id".to_string())
    })?;

    // For now, return not found since we don't have playlists yet
    Err(crate::error::Error::NotFound(format!(
        "Playlist not found: {}",
        id
    )))
}

/// GET /rest/createPlaylist - Create or update a playlist
pub async fn create_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    QsQuery(_params): QsQuery<CreatePlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse>> {
    // TODO: Implement playlist creation
    Err(crate::error::Error::InvalidRequest(
        "Playlist creation not yet implemented".to_string(),
    ))
}

/// GET /rest/updatePlaylist - Update a playlist
pub async fn update_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    QsQuery(_params): QsQuery<UpdatePlaylistParams>,
) -> Result<FormatEmptyResponse> {
    // TODO: Implement playlist update
    Err(crate::error::Error::InvalidRequest(
        "Playlist update not yet implemented".to_string(),
    ))
}

/// GET /rest/deletePlaylist - Delete a playlist
pub async fn delete_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<PlaylistParams>,
) -> Result<FormatEmptyResponse> {
    let id = params.id.ok_or_else(|| {
        crate::error::Error::InvalidRequest("Missing required parameter: id".to_string())
    })?;

    // For now, return not found
    Err(crate::error::Error::NotFound(format!(
        "Playlist not found: {}",
        id
    )))
}
