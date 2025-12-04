//! Play history endpoints for the Subsonic API.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{
    get_ratings_map, get_starred_map, song_to_response, SongResponse,
};
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ===== getPlayHistory - Ferrotune extension =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryParams {
    size: Option<u32>,
    offset: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryResponse {
    pub play_history: PlayHistoryContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryContent {
    pub entry: Vec<PlayHistoryEntry>,
    /// Total count of play history entries
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryEntry {
    #[serde(flatten)]
    pub song: SongResponse,
    pub played_at: String,
}

/// Row type for the scrobble join query
#[derive(Debug, Clone, sqlx::FromRow)]
struct ScrobbleWithSong {
    // Song fields
    id: String,
    title: String,
    album_id: Option<String>,
    album_name: Option<String>,
    artist_id: String,
    artist_name: String,
    track_number: Option<i32>,
    disc_number: i32,
    year: Option<i32>,
    genre: Option<String>,
    duration: i64,
    bitrate: Option<i32>,
    file_path: String,
    file_size: i64,
    file_format: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    // Scrobble field
    played_at: DateTime<Utc>,
}

impl ScrobbleWithSong {
    fn into_song(self) -> (crate::db::models::Song, DateTime<Utc>) {
        (
            crate::db::models::Song {
                id: self.id,
                title: self.title,
                album_id: self.album_id,
                album_name: self.album_name,
                artist_id: self.artist_id,
                artist_name: self.artist_name,
                track_number: self.track_number,
                disc_number: self.disc_number,
                year: self.year,
                genre: self.genre,
                duration: self.duration,
                bitrate: self.bitrate,
                file_path: self.file_path,
                file_size: self.file_size,
                file_format: self.file_format,
                created_at: self.created_at,
                updated_at: self.updated_at,
            },
            self.played_at,
        )
    }
}

/// GET /rest/getPlayHistory - Get user's play history (Ferrotune extension)
pub async fn get_play_history(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<PlayHistoryParams>,
) -> Result<FormatResponse<PlayHistoryResponse>> {
    let size = params.size.unwrap_or(50).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    // Get scrobbles with song data joined, deduplicated by song_id (keeping most recent play)
    // Uses a subquery to get the most recent played_at for each song per user
    let scrobbles: Vec<ScrobbleWithSong> = sqlx::query_as(
        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                  s.track_number, s.disc_number, s.year, s.genre, s.duration,
                  s.bitrate, s.file_path, s.file_size, s.file_format, 
                  s.created_at, s.updated_at, sc.played_at
           FROM scrobbles sc
           INNER JOIN songs s ON sc.song_id = s.id
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           WHERE sc.user_id = ? AND sc.submission = 1
             AND sc.played_at = (
               SELECT MAX(sc2.played_at)
               FROM scrobbles sc2
               WHERE sc2.song_id = sc.song_id AND sc2.user_id = sc.user_id AND sc2.submission = 1
             )
           ORDER BY sc.played_at DESC
           LIMIT ? OFFSET ?"#,
    )
    .bind(user.user_id)
    .bind(size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // Get total count of unique songs in history
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT song_id) FROM scrobbles WHERE user_id = ? AND submission = 1",
    )
    .bind(user.user_id)
    .fetch_one(&state.pool)
    .await?;

    // Convert to songs with played_at
    let scrobble_data: Vec<_> = scrobbles.into_iter().map(|s| s.into_song()).collect();

    // Get starred status and ratings for all songs in the result
    let song_ids: Vec<String> = scrobble_data.iter().map(|(s, _)| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    // Convert to response format
    let entries: Vec<PlayHistoryEntry> = scrobble_data
        .into_iter()
        .map(|(song, played_at)| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            PlayHistoryEntry {
                song: song_to_response(song, None, starred, user_rating),
                played_at: played_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            }
        })
        .collect();

    let response = PlayHistoryResponse {
        play_history: PlayHistoryContent {
            entry: entries,
            total: Some(total.0),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
