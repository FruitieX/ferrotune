//! List endpoints for the Ferrotune API.
//!
//! This module provides list endpoints migrated from the OpenSubsonic API,
//! using proper HTTP status codes and simpler JSON responses.

pub use crate::api::common::lists::AlbumListType;
use crate::api::common::lists::{
    get_album_list_logic, get_random_songs_logic, get_songs_by_genre_logic,
};
use crate::api::common::models::{AlbumResponse, SongResponse};
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::FerrotuneApiResult;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Album Lists Endpoint
// ============================================================================

/// Query params for album list endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumListParams {
    /// Type of list to fetch
    #[serde(rename = "type")]
    pub list_type: AlbumListType,
    /// Number of albums to return (default 10)
    pub size: Option<i64>,
    /// Step/offset for pagination
    pub offset: Option<i64>,
    /// Year range (for ByYear type)
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
    /// Genre (for ByGenre type)
    pub genre: Option<String>,
    /// Include inline cover art thumbnails (small or medium)
    pub inline_images: Option<String>,
    /// Only count scrobbles since this ISO date (for Frequent type)
    pub since: Option<String>,
    /// Random seed for reproducible random ordering (for Random type)
    #[serde(default)]
    pub seed: Option<i64>,
}

/// Response for album list
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneAlbumListResponse {
    pub album: Vec<AlbumResponse>,
    /// Total number of albums matching the criteria (for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub total: Option<i64>,
    /// Random seed used for the Random list type (for reproducible ordering)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub seed: Option<i64>,
}

/// GET /ferrotune/albums - Get lists of albums
pub async fn get_album_list(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AlbumListParams>,
) -> FerrotuneApiResult<Json<FerrotuneAlbumListResponse>> {
    use crate::thumbnails::ThumbnailSize;

    let size = params.size.unwrap_or(10).min(500);
    let offset = params.offset.unwrap_or(0);

    // Parse inline images parameter
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    let result = get_album_list_logic(
        &state.pool,
        user.user_id,
        params.list_type,
        size,
        offset,
        params.from_year,
        params.to_year,
        params.genre,
        inline_size,
        params.since,
        params.seed,
    )
    .await?;

    Ok(Json(FerrotuneAlbumListResponse {
        album: result.albums,
        total: result.total,
        seed: result.seed,
    }))
}

// ============================================================================
// Random Songs Endpoint
// ============================================================================

/// Query params for random songs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomSongsParams {
    /// Number of songs to return (default 10)
    pub size: Option<i64>,
    /// Only songs from this genre
    pub genre: Option<String>,
    /// Only songs from this year range
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
}

/// Response for random songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneRandomSongsResponse {
    pub song: Vec<SongResponse>,
}

/// GET /ferrotune/songs/random - Get random songs
pub async fn get_random_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<RandomSongsParams>,
) -> FerrotuneApiResult<Json<FerrotuneRandomSongsResponse>> {
    let size = params.size.unwrap_or(10).min(500);

    let songs = get_random_songs_logic(
        &state.pool,
        user.user_id,
        size,
        params.genre,
        params.from_year,
        params.to_year,
    )
    .await?;

    Ok(Json(FerrotuneRandomSongsResponse { song: songs }))
}

// ============================================================================
// Songs By Genre Endpoint
// ============================================================================

/// Query params for songs by genre
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongsByGenreParams {
    /// Genre to filter by
    pub genre: String,
    /// Number of songs to return (default 10)
    pub count: Option<i64>,
    /// Step/offset for pagination
    pub offset: Option<i64>,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

/// Response for songs by genre
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSongsByGenreResponse {
    pub song: Vec<SongResponse>,
}

/// GET /ferrotune/songs/by-genre - Get songs in a specific genre
pub async fn get_songs_by_genre(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SongsByGenreParams>,
) -> FerrotuneApiResult<Json<FerrotuneSongsByGenreResponse>> {
    let count = params.count.unwrap_or(10).min(500);
    let offset = params.offset.unwrap_or(0);

    let songs = get_songs_by_genre_logic(
        &state.pool,
        user.user_id,
        &params.genre,
        count,
        offset,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await?;

    Ok(Json(FerrotuneSongsByGenreResponse { song: songs }))
}
