//! Search endpoints for the OpenSubsonic API.
//!
//! Uses common search logic from api::common::search with additional
//! OpenSubsonic-specific features like inline thumbnails.

use crate::api::common::models::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::common::search::SearchParams;
use crate::api::common::search_utils::execute_search;
use crate::api::common::utils::parse_inline_images;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SearchResult3 {
    pub search_result3: SearchContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SearchContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
    /// Total count of matching artists (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub artist_total: Option<i64>,
    /// Total count of matching albums (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub album_total: Option<i64>,
    /// Total count of matching songs (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub song_total: Option<i64>,
}

pub async fn search3(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> Result<FormatResponse<SearchResult3>> {
    let artist_count = params.artist_count.unwrap_or(20).min(500) as i64;
    let artist_offset = params.artist_offset.unwrap_or(0) as i64;
    let album_count = params.album_count.unwrap_or(20).min(500) as i64;
    let album_offset = params.album_offset.unwrap_or(0) as i64;
    let song_count = params.song_count.unwrap_or(20).min(500) as i64;
    let song_offset = params.song_offset.unwrap_or(0) as i64;

    // Parse inline images parameter
    // TODO: this is not part of OpenSubsonic spec
    let inline_size = parse_inline_images(params.inline_images.as_deref());

    // Execute search with post-processing using shared utility
    let results = execute_search(
        &state.database,
        user.user_id,
        &params.query,
        &params,
        artist_count,
        artist_offset,
        album_count,
        album_offset,
        song_count,
        song_offset,
        inline_size,
    )
    .await?;

    let response = SearchResult3 {
        search_result3: SearchContent {
            artist: results.artist_responses,
            album: results.album_responses,
            song: results.song_responses,
            artist_total: results.artist_total,
            album_total: results.album_total,
            song_total: results.song_total,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
