//! Play history endpoints for the Ferrotune API.
//!
//! This module provides play history endpoints using common logic from common/history.rs.

use crate::api::common::history::{
    fetch_play_history, PlayHistoryParams as CommonPlayHistoryParams,
};
use crate::api::common::models::SongResponse;
use crate::api::common::utils::parse_inline_images;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::FerrotuneApiResult;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryParams {
    pub size: Option<u32>,
    pub offset: Option<u32>,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(default)]
    pub inline_images: Option<String>,
}

/// Response for play history
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotunePlayHistoryResponse {
    pub entry: Vec<FerrotunePlayHistoryEntry>,
    /// Total count of play history entries
    #[ts(type = "number | null")]
    pub total: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotunePlayHistoryEntry {
    #[serde(flatten)]
    #[ts(flatten)]
    pub song: SongResponse,
    pub played_at: String,
}

/// GET /ferrotune/history - Get user's play history
pub async fn get_play_history(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<PlayHistoryParams>,
) -> FerrotuneApiResult<Json<FerrotunePlayHistoryResponse>> {
    let result = fetch_play_history(
        &state.database,
        user.user_id,
        CommonPlayHistoryParams {
            size: params.size.unwrap_or(50).min(500) as i64,
            offset: params.offset.unwrap_or(0) as i64,
            filter: params.filter,
            sort: params.sort,
            sort_dir: params.sort_dir,
            inline_size: parse_inline_images(params.inline_images.as_deref()),
        },
    )
    .await?;

    let entries: Vec<FerrotunePlayHistoryEntry> = result
        .entries
        .into_iter()
        .map(|item| FerrotunePlayHistoryEntry {
            song: item.song,
            played_at: item.played_at,
        })
        .collect();

    Ok(Json(FerrotunePlayHistoryResponse {
        entry: entries,
        total: Some(result.total),
    }))
}
