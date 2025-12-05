//! Server statistics endpoint for the Ferrotune Admin API.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::Result;
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
pub async fn get_stats(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatsResponse>> {
    // Get counts for various entities
    let (song_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM songs")
        .fetch_one(&state.pool)
        .await?;

    let (album_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM albums")
        .fetch_one(&state.pool)
        .await?;

    let (artist_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM artists")
        .fetch_one(&state.pool)
        .await?;

    let (genre_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(DISTINCT genre) FROM songs WHERE genre IS NOT NULL")
            .fetch_one(&state.pool)
            .await?;

    let (playlist_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
        .fetch_one(&state.pool)
        .await?;

    // Get total duration and size
    let (total_duration, total_size): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT SUM(duration), SUM(file_size) FROM songs")
            .fetch_one(&state.pool)
            .await?;

    // Get total plays for this user
    let (total_plays,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM scrobbles WHERE user_id = ? AND submission = 1")
            .bind(user.user_id)
            .fetch_one(&state.pool)
            .await?;

    Ok(Json(StatsResponse {
        song_count,
        album_count,
        artist_count,
        genre_count,
        playlist_count,
        total_duration_seconds: total_duration.unwrap_or(0),
        total_size_bytes: total_size.unwrap_or(0),
        total_plays,
    }))
}
