//! Starring and rating endpoints for the Ferrotune API.
//!
//! This module provides starring/favoriting and rating endpoints migrated from
//! the native API API, using proper HTTP status codes.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::common::starring::{
    fetch_starred_content, set_item_rating, star_items, unstar_items,
};
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Star/Unstar Endpoints
// ============================================================================

/// Request body for star/unstar operations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarRequest {
    /// Song IDs to star/unstar
    #[serde(default)]
    pub id: Vec<String>,
    /// Album IDs to star/unstar
    #[serde(default)]
    pub album_id: Vec<String>,
    /// Artist IDs to star/unstar
    #[serde(default)]
    pub artist_id: Vec<String>,
}

/// POST /api/star - Star (favorite) items
pub async fn star(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StarRequest>,
) -> FerrotuneApiResult<StatusCode> {
    star_items(
        &state.database,
        user.user_id,
        &request.id,
        &request.album_id,
        &request.artist_id,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/unstar - Unstar (unfavorite) items
pub async fn unstar(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StarRequest>,
) -> FerrotuneApiResult<StatusCode> {
    unstar_items(
        &state.database,
        user.user_id,
        &request.id,
        &request.album_id,
        &request.artist_id,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Rating Endpoint
// ============================================================================

/// Request body for rating operations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingRequest {
    /// Item ID to rate
    pub id: String,
    /// Rating value (0-5, where 0 removes the rating)
    pub rating: i32,
}

/// POST /api/rating - Set rating for an item
pub async fn set_rating(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RatingRequest>,
) -> FerrotuneApiResult<StatusCode> {
    if request.rating < 0 || request.rating > 5 {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "Rating must be between 0 and 5".to_string(),
        )));
    }

    set_item_rating(&state.database, user.user_id, &request.id, request.rating).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Get Starred Endpoint
// ============================================================================

/// Response for get starred items
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneStarredResponse {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artists: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub albums: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub songs: Vec<SongResponse>,
}

/// GET /api/starred - Get all starred items for the current user
pub async fn get_starred(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<FerrotuneStarredResponse>> {
    let (artist_responses, album_responses, song_responses) =
        fetch_starred_content(&state.database, user.user_id).await?;

    Ok(Json(FerrotuneStarredResponse {
        artists: artist_responses,
        albums: album_responses,
        songs: song_responses,
    }))
}

// ============================================================================
// Song likes
// ============================================================================

/// The song's like state after a like tap.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongLikeResponse {
    pub song_id: String,
    /// True when the tap added a like, false when it undid the newest one.
    pub liked: bool,
    #[ts(type = "number")]
    pub like_count: i64,
    pub last_liked: Option<String>,
    /// The song's favorite timestamp after the tap: liking a song favorites
    /// it, and undoing the like that did so unfavorites it again.
    pub starred: Option<String>,
}

/// POST /api/songs/{id}/like - Like a song again, or undo the newest like
/// when it is less than 12 hours old (so repeated taps never pile up).
pub async fn toggle_song_like(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> FerrotuneApiResult<Json<SongLikeResponse>> {
    if !crate::db::repo::listening::song_exists(&state.database, &song_id).await? {
        return Err(Error::NotFound("Song not found".to_string()).into());
    }
    let toggle = crate::db::repo::song_likes::toggle_song_like(
        &state.database,
        user.user_id,
        &song_id,
        chrono::Utc::now(),
    )
    .await?;
    Ok(Json(SongLikeResponse {
        song_id,
        liked: toggle.liked,
        like_count: toggle.like_count,
        last_liked: toggle
            .last_liked
            .map(crate::api::common::utils::format_datetime_iso_ms),
        starred: toggle
            .starred_at
            .map(crate::api::common::utils::format_datetime_iso_ms),
    }))
}
