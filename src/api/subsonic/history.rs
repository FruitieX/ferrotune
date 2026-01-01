//! Play history endpoints for the Subsonic API.

use crate::api::common::history::{
    fetch_play_history, PlayHistoryParams as CommonPlayHistoryParams,
};
use crate::api::common::models::SongResponse;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::InlineImagesParam;
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ===== getPlayHistory - Ferrotune extension =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryParams {
    size: Option<u32>,
    offset: Option<u32>,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    filter: Option<String>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(flatten)]
    inline_images: InlineImagesParam,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayHistoryResponse {
    pub play_history: PlayHistoryContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayHistoryContent {
    pub entry: Vec<PlayHistoryEntry>,
    /// Total count of play history entries
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub total: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayHistoryEntry {
    #[serde(flatten)]
    #[ts(flatten)]
    pub song: SongResponse,
    pub played_at: String,
}

/// GET /rest/getPlayHistory - Get user's play history (Ferrotune extension)
pub async fn get_play_history(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<PlayHistoryParams>,
) -> Result<FormatResponse<PlayHistoryResponse>> {
    let result = fetch_play_history(
        &state.pool,
        user.user_id,
        CommonPlayHistoryParams {
            size: params.size.unwrap_or(50).min(500) as i64,
            offset: params.offset.unwrap_or(0) as i64,
            filter: params.filter,
            sort: params.sort,
            sort_dir: params.sort_dir,
            inline_size: params.inline_images.get_size(),
        },
    )
    .await?;

    let entries: Vec<PlayHistoryEntry> = result
        .entries
        .into_iter()
        .map(|item| PlayHistoryEntry {
            song: item.song,
            played_at: item.played_at,
        })
        .collect();

    let response = PlayHistoryResponse {
        play_history: PlayHistoryContent {
            entry: entries,
            total: Some(result.total),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
