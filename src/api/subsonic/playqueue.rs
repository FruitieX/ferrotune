use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{get_ratings_map, get_starred_map, song_to_response};
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::QsQuery;
use crate::api::{first_string_or_none, string_or_seq};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::State;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlayQueueParams {
    #[serde(default, deserialize_with = "string_or_seq")]
    id: Vec<String>,
    #[serde(default, deserialize_with = "first_string_or_none")]
    current: Option<String>,
    #[serde(default, deserialize_with = "crate::api::subsonic::query::first_i64_or_none")]
    position: Option<i64>,
}

#[derive(Serialize)]
pub struct PlayQueueResponse {
    #[serde(rename = "playQueue")]
    pub play_queue: PlayQueueContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayQueueContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    pub entry: Vec<crate::api::subsonic::browse::SongResponse>,
}

/// GET /rest/savePlayQueue - Save the current play queue
pub async fn save_play_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<SavePlayQueueParams>,
) -> Result<impl axum::response::IntoResponse> {
    // Delete existing queue entries for this user
    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    // Insert new queue entries
    for (position, song_id) in params.id.iter().enumerate() {
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position) VALUES (?, ?, ?)",
        )
        .bind(user.user_id)
        .bind(song_id)
        .bind(position as i64)
        .execute(&state.pool)
        .await?;
    }

    // Upsert the queue metadata
    sqlx::query(
        "INSERT INTO play_queues (user_id, current_song_id, position, changed_at, changed_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            current_song_id = excluded.current_song_id,
            position = excluded.position,
            changed_at = excluded.changed_at,
            changed_by = excluded.changed_by",
    )
    .bind(user.user_id)
    .bind(&params.current)
    .bind(params.position.unwrap_or(0))
    .bind(Utc::now())
    .bind(&user.client)
    .execute(&state.pool)
    .await?;

    Ok(format_ok_empty(user.format))
}

/// GET /rest/getPlayQueue - Get the saved play queue
pub async fn get_play_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<PlayQueueResponse>> {
    // Get queue metadata
    let queue_meta: Option<(Option<String>, i64, chrono::DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT current_song_id, position, changed_at, changed_by FROM play_queues WHERE user_id = ?",
    )
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;

    // Get queue entries with song data
    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         WHERE pqe.user_id = ?
         ORDER BY pqe.queue_position ASC",
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    let song_responses: Vec<crate::api::subsonic::browse::SongResponse> = songs
        .into_iter()
        .map(|song| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            song_to_response(song, None, starred, user_rating)
        })
        .collect();

    let (current, position, changed, changed_by) = queue_meta
        .map(|(cur, pos, changed, by)| {
            (
                cur,
                Some(pos),
                Some(changed.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                Some(by),
            )
        })
        .unwrap_or((None, None, None, None));

    let response = PlayQueueResponse {
        play_queue: PlayQueueContent {
            current,
            position,
            username: Some(user.username),
            changed,
            changed_by,
            entry: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
