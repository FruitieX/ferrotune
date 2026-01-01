//! Search endpoints for the Ferrotune API.
//!
//! This module provides search endpoints migrated from the OpenSubsonic API,
//! using proper HTTP status codes and simpler JSON responses.

use crate::api::common::models::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::common::search::SearchParams;
use crate::api::common::search_utils::execute_search;
use crate::api::common::utils::parse_inline_images;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::FerrotuneApiResult;
use axum::extract::{Query, State};
use axum::Json;
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Search Endpoint
// ============================================================================

/// Response for search results
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSearchResponse {
    pub search_result: FerrotuneSearchContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSearchContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
    /// Total count of matching artists
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub artist_total: Option<i64>,
    /// Total count of matching albums
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_total: Option<i64>,
    /// Total count of matching songs
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub song_total: Option<i64>,
}

/// GET /ferrotune/search - Search for artists, albums, or songs
pub async fn search(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> FerrotuneApiResult<Json<FerrotuneSearchResponse>> {
    let artist_count = params.artist_count.unwrap_or(20).min(500) as i64;
    let artist_offset = params.artist_offset.unwrap_or(0) as i64;
    let album_count = params.album_count.unwrap_or(20).min(500) as i64;
    let album_offset = params.album_offset.unwrap_or(0) as i64;
    let song_count = params.song_count.unwrap_or(20).min(500) as i64;
    let song_offset = params.song_offset.unwrap_or(0) as i64;

    // Parse inline images parameter
    let inline_size = parse_inline_images(params.inline_images.as_deref());

    // Execute search with post-processing using shared utility
    let results = execute_search(
        &state.pool,
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

    Ok(Json(FerrotuneSearchResponse {
        search_result: FerrotuneSearchContent {
            artist: results.artist_responses,
            album: results.album_responses,
            song: results.song_responses,
            artist_total: results.artist_total,
            album_total: results.album_total,
            song_total: results.song_total,
        },
    }))
}
