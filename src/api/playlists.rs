use crate::api::auth::AuthenticatedUser;
use crate::api::response::{FormatEmptyResponse, FormatResponse};
use crate::api::xml::{XmlPlaylistWithSongsResponse, XmlPlaylistsInner, XmlPlaylistsResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistParams {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlaylistParams {
    playlist_id: Option<String>,
    name: Option<String>,
    song_id: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaylistParams {
    playlist_id: String,
    name: Option<String>,
    comment: Option<String>,
    public: Option<bool>,
    song_id_to_add: Option<Vec<String>>,
    song_index_to_remove: Option<Vec<u32>>,
}

// Response types
#[derive(Serialize)]
pub struct PlaylistsResponse {
    playlists: PlaylistsWrapper,
}

#[derive(Serialize)]
pub struct PlaylistsWrapper {
    playlist: Vec<PlaylistResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistResponse {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    owner: String,
    public: bool,
    song_count: i64,
    duration: i64,
    created: String,
    changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art: Option<String>,
}

#[derive(Serialize)]
pub struct PlaylistWithSongsResponse {
    playlist: PlaylistDetailResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetailResponse {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    owner: String,
    public: bool,
    song_count: i64,
    duration: i64,
    created: String,
    changed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art: Option<String>,
    entry: Vec<crate::api::browse::SongResponse>,
}

/// GET /rest/getPlaylists - Get all playlists
pub async fn get_playlists(
    State(_state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<FormatResponse<PlaylistsResponse, XmlPlaylistsResponse>> {
    // Return empty playlists for now
    let json_response = PlaylistsResponse {
        playlists: PlaylistsWrapper {
            playlist: vec![],
        },
    };
    
    let xml_response = XmlPlaylistsResponse::ok(XmlPlaylistsInner {
        playlist: vec![],
    });
    
    Ok(FormatResponse::new(user.format, json_response, xml_response))
}

/// GET /rest/getPlaylist - Get a specific playlist
pub async fn get_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<PlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse, XmlPlaylistWithSongsResponse>> {
    let id = params.id.ok_or_else(|| {
        crate::error::Error::InvalidRequest("Missing required parameter: id".to_string())
    })?;

    // For now, return not found since we don't have playlists yet
    Err(crate::error::Error::NotFound(format!("Playlist not found: {}", id)))
}

/// GET /rest/createPlaylist - Create or update a playlist
pub async fn create_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    axum::extract::Query(_params): axum::extract::Query<CreatePlaylistParams>,
) -> Result<FormatResponse<PlaylistWithSongsResponse, XmlPlaylistWithSongsResponse>> {
    // TODO: Implement playlist creation
    Err(crate::error::Error::InvalidRequest("Playlist creation not yet implemented".to_string()))
}

/// GET /rest/updatePlaylist - Update a playlist
pub async fn update_playlist(
    State(_state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
    axum::extract::Query(_params): axum::extract::Query<UpdatePlaylistParams>,
) -> Result<FormatEmptyResponse> {
    // TODO: Implement playlist update
    Err(crate::error::Error::InvalidRequest("Playlist update not yet implemented".to_string()))
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
    Err(crate::error::Error::NotFound(format!("Playlist not found: {}", id)))
}
