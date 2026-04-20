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
    use crate::db::raw;
    use sea_orm::Value;

    let uid = || Value::from(user.user_id);
    let empty = || std::iter::empty::<Value>();
    let conn = state.database.conn();

    let song_count = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(*) FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled = 1 AND ula.user_id = ?",
        "SELECT COUNT(*) FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled AND ula.user_id = $1",
        [uid()],
    )
    .await?
    .unwrap_or(0);

    let album_count = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(DISTINCT a.id) FROM albums a
             INNER JOIN songs s ON s.album_id = a.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled = 1 AND ula.user_id = ?",
        "SELECT COUNT(DISTINCT a.id) FROM albums a
             INNER JOIN songs s ON s.album_id = a.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled AND ula.user_id = $1",
        [uid()],
    )
    .await?
    .unwrap_or(0);

    let artist_count = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(DISTINCT ar.id) FROM artists ar
             INNER JOIN songs s ON s.artist_id = ar.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled = 1 AND ula.user_id = ?",
        "SELECT COUNT(DISTINCT ar.id) FROM artists ar
             INNER JOIN songs s ON s.artist_id = ar.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled AND ula.user_id = $1",
        [uid()],
    )
    .await?
    .unwrap_or(0);

    let genre_count = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(DISTINCT s.genre) FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE s.genre IS NOT NULL AND mf.enabled = 1 AND ula.user_id = ?",
        "SELECT COUNT(DISTINCT s.genre) FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE s.genre IS NOT NULL AND mf.enabled AND ula.user_id = $1",
        [uid()],
    )
    .await?
    .unwrap_or(0);

    let playlist_count = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(*) FROM playlists",
        "SELECT COUNT(*) FROM playlists",
        empty(),
    )
    .await?
    .unwrap_or(0);

    #[derive(sea_orm::FromQueryResult)]
    struct SumRow {
        total_duration: Option<i64>,
        total_size: Option<i64>,
    }
    let sums = raw::query_one::<SumRow>(
        conn,
        "SELECT SUM(s.duration) AS total_duration, SUM(s.file_size) AS total_size FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled = 1 AND ula.user_id = ?",
        "SELECT COALESCE(SUM(s.duration), 0)::BIGINT AS total_duration,
                COALESCE(SUM(s.file_size), 0)::BIGINT AS total_size
             FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE mf.enabled AND ula.user_id = $1",
        [uid()],
    )
    .await?
    .unwrap_or(SumRow {
        total_duration: None,
        total_size: None,
    });
    let total_duration_seconds = sums.total_duration.unwrap_or(0);
    let total_size_bytes = sums.total_size.unwrap_or(0);

    let total_plays = raw::query_scalar::<i64>(
        conn,
        "SELECT COUNT(*) FROM scrobbles WHERE user_id = ? AND submission = 1",
        "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND submission",
        [uid()],
    )
    .await?
    .unwrap_or(0);

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
