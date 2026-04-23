//! Disabled songs endpoints.
//!
//! Allows users to mark songs as disabled. Disabled songs are not automatically
//! included in playback queues and show up as grayed out in library views.
//! The only way to play a disabled song is to start playback directly.

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

/// Response for getting disabled status
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DisabledStatusResponse {
    pub song_id: String,
    pub disabled: bool,
}

/// Response for getting all disabled songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DisabledSongsResponse {
    pub song_ids: Vec<String>,
}

/// Request body for setting disabled status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisabledRequest {
    pub disabled: bool,
}

/// Request body for bulk setting disabled status
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkSetDisabledRequest {
    pub song_ids: Vec<String>,
    pub disabled: bool,
}

/// Response for bulk operation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkDisabledResponse {
    pub count: usize,
    pub disabled: bool,
}

/// Get disabled status for a song.
///
/// GET /ferrotune/songs/:id/disabled
pub async fn get_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> FerrotuneApiResult<Json<DisabledStatusResponse>> {
    let disabled = song_flags::is_song_disabled(&state.database, user.user_id, &song_id).await?;

    Ok(Json(DisabledStatusResponse { song_id, disabled }))
}

/// Set disabled status for a song.
///
/// PUT /ferrotune/songs/:id/disabled
pub async fn set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetDisabledRequest>,
) -> FerrotuneApiResult<Json<DisabledStatusResponse>> {
    song_flags::set_song_disabled(&state.database, user.user_id, &song_id, body.disabled)
        .await
        .map_err(|e| Error::Internal(format!("Failed to set disabled state: {}", e)))?;

    Ok(Json(DisabledStatusResponse {
        song_id,
        disabled: body.disabled,
    }))
}

/// Get all disabled songs for the current user.
///
/// GET /ferrotune/disabled-songs
pub async fn get_all_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<DisabledSongsResponse>> {
    let song_ids = song_flags::list_disabled_song_ids(&state.database, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get disabled songs: {}", e)))?;

    Ok(Json(DisabledSongsResponse { song_ids }))
}

/// Bulk set disabled status for multiple songs.
///
/// POST /ferrotune/disabled-songs/bulk
pub async fn bulk_set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetDisabledRequest>,
) -> FerrotuneApiResult<Json<BulkDisabledResponse>> {
    let count = body.song_ids.len();

    song_flags::bulk_set_disabled(&state.database, user.user_id, &body.song_ids, body.disabled)
        .await?;

    Ok(Json(BulkDisabledResponse {
        count,
        disabled: body.disabled,
    }))
}
