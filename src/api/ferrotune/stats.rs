//! Server statistics endpoint for the Ferrotune Admin API.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
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
    let (
        song_count,
        album_count,
        artist_count,
        genre_count,
        playlist_count,
        total_duration_seconds,
        total_size_bytes,
        total_plays,
    ) = if let Ok(pool) = state.database.sqlite_pool() {
        let (song_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled = 1 AND ula.user_id = ?",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (album_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT a.id) FROM albums a
                 INNER JOIN songs s ON s.album_id = a.id
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled = 1 AND ula.user_id = ?",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (artist_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT ar.id) FROM artists ar
                 INNER JOIN songs s ON s.artist_id = ar.id
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled = 1 AND ula.user_id = ?",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (genre_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT s.genre) FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE s.genre IS NOT NULL AND mf.enabled = 1 AND ula.user_id = ?",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (playlist_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
            .fetch_one(pool)
            .await?;

        let (total_duration, total_size): (Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT SUM(s.duration), SUM(s.file_size) FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled = 1 AND ula.user_id = ?",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (total_plays,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM scrobbles WHERE user_id = ? AND submission = 1")
                .bind(user.user_id)
                .fetch_one(pool)
                .await?;

        (
            song_count,
            album_count,
            artist_count,
            genre_count,
            playlist_count,
            total_duration.unwrap_or(0),
            total_size.unwrap_or(0),
            total_plays,
        )
    } else {
        let pool = state.database.postgres_pool()?;

        let (song_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled AND ula.user_id = $1",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (album_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT a.id) FROM albums a
                 INNER JOIN songs s ON s.album_id = a.id
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled AND ula.user_id = $1",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (artist_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT ar.id) FROM artists ar
                 INNER JOIN songs s ON s.artist_id = ar.id
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled AND ula.user_id = $1",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (genre_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT s.genre) FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE s.genre IS NOT NULL AND mf.enabled AND ula.user_id = $1",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (playlist_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
            .fetch_one(pool)
            .await?;

        let (total_duration_seconds, total_size_bytes): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(SUM(s.duration), 0)::BIGINT, COALESCE(SUM(s.file_size), 0)::BIGINT
                 FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE mf.enabled AND ula.user_id = $1",
        )
        .bind(user.user_id)
        .fetch_one(pool)
        .await?;

        let (total_plays,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND submission")
                .bind(user.user_id)
                .fetch_one(pool)
                .await?;

        (
            song_count,
            album_count,
            artist_count,
            genre_count,
            playlist_count,
            total_duration_seconds,
            total_size_bytes,
            total_plays,
        )
    };

    Ok(Json(StatsResponse {
        song_count,
        album_count,
        artist_count,
        genre_count,
        playlist_count,
        total_duration_seconds,
        total_size_bytes,
        total_plays,
    }))
}
