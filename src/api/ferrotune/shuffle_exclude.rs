//! Shuffle exclude endpoints.
//!
//! Allows users to mark songs as excluded from shuffle playback.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::song_flags;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Response for getting shuffle exclude status
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShuffleExcludeStatusResponse {
    pub song_id: String,
    pub excluded: bool,
}

/// Response for getting all excluded songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShuffleExcludesResponse {
    pub song_ids: Vec<String>,
}

/// Request body for setting shuffle exclude status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetShuffleExcludeRequest {
    pub excluded: bool,
}

/// Request body for bulk setting shuffle exclude status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSetShuffleExcludeRequest {
    pub song_ids: Vec<String>,
    pub excluded: bool,
}

/// Response for bulk operation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkShuffleExcludeResponse {
    pub count: usize,
    pub excluded: bool,
}

/// Get shuffle exclude status for a song.
///
/// GET /ferrotune/songs/:id/shuffle-exclude
pub async fn get_shuffle_exclude(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> FerrotuneApiResult<Json<ShuffleExcludeStatusResponse>> {
    let excluded =
        song_flags::is_song_shuffle_excluded(&state.database, user.user_id, &song_id).await?;

    Ok(Json(ShuffleExcludeStatusResponse { song_id, excluded }))
}

/// Set shuffle exclude status for a song.
///
/// PUT /ferrotune/songs/:id/shuffle-exclude
pub async fn set_shuffle_exclude(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetShuffleExcludeRequest>,
) -> FerrotuneApiResult<Json<ShuffleExcludeStatusResponse>> {
    song_flags::set_song_shuffle_excluded(&state.database, user.user_id, &song_id, body.excluded)
        .await
        .map_err(|e| Error::Internal(format!("Failed to set shuffle exclude state: {}", e)))?;

    Ok(Json(ShuffleExcludeStatusResponse {
        song_id,
        excluded: body.excluded,
    }))
}

/// Get all songs excluded from shuffle for the current user.
///
/// GET /ferrotune/shuffle-excludes
pub async fn get_all_shuffle_excludes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ShuffleExcludesResponse>> {
    let song_ids = song_flags::list_shuffle_excluded_song_ids(&state.database, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get excludes: {}", e)))?;

    Ok(Json(ShuffleExcludesResponse { song_ids }))
}

/// Bulk set shuffle exclude status for multiple songs.
///
/// POST /ferrotune/shuffle-excludes/bulk
pub async fn bulk_set_shuffle_excludes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetShuffleExcludeRequest>,
) -> FerrotuneApiResult<Json<BulkShuffleExcludeResponse>> {
    let count = body.song_ids.len();

    song_flags::bulk_set_shuffle_excluded(
        &state.database,
        user.user_id,
        &body.song_ids,
        body.excluded,
    )
    .await?;

    Ok(Json(BulkShuffleExcludeResponse {
        count,
        excluded: body.excluded,
    }))
}
