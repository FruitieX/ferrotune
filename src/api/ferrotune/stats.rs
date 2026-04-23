//! Server statistics endpoint for the Ferrotune Admin API.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::stats as stats_repo;
use crate::error::FerrotuneApiResult;
use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// Server statistics response.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StatsResponse {
    /// Total number of songs in the library
    #[ts(type = "number")]
    pub song_count: i64,
    /// Total number of albums in the library
    #[ts(type = "number")]
    pub album_count: i64,
    /// Total number of artists in the library
    #[ts(type = "number")]
    pub artist_count: i64,
    /// Total number of genres in the library
    #[ts(type = "number")]
    pub genre_count: i64,
    /// Total number of playlists
    #[ts(type = "number")]
    pub playlist_count: i64,
    /// Total duration of all songs in seconds
    #[ts(type = "number")]
    pub total_duration_seconds: i64,
    /// Total size of all songs in bytes
    #[ts(type = "number")]
    pub total_size_bytes: i64,
    /// Total number of plays (scrobbles) for this user
    #[ts(type = "number")]
    pub total_plays: i64,
}

/// GET /ferrotune/stats - Get server statistics
/// Only includes content from enabled music folders.
pub async fn get_stats(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<StatsResponse>> {
    let stats = stats_repo::get_user_library_stats(&state.database, user.user_id).await?;

    Ok(Json(StatsResponse {
        song_count: stats.song_count,
        album_count: stats.album_count,
        artist_count: stats.artist_count,
        genre_count: stats.genre_count,
        playlist_count: stats.playlist_count,
        total_duration_seconds: stats.total_duration_seconds,
        total_size_bytes: stats.total_size_bytes,
        total_plays: stats.total_plays,
    }))
}
