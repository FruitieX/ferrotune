use crate::api::common::browse::song_to_response;
use crate::api::common::playqueue::find_current_index;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::api::QsQuery;
use crate::api::{first_string_or_none, string_or_seq};
use crate::db::models::ItemType;
use crate::error::Result;
use axum::extract::State;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlayQueueParams {
    #[serde(default, deserialize_with = "string_or_seq")]
    id: Vec<String>,
    #[serde(default, deserialize_with = "first_string_or_none")]
    current: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::api::subsonic::query::first_i64_or_none"
    )]
    position: Option<i64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayQueueResponse {
    #[serde(rename = "playQueue")]
    pub play_queue: PlayQueueContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayQueueContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    pub entry: Vec<crate::api::common::models::SongResponse>,
}

/// GET /rest/savePlayQueue - Save the current play queue
///
/// This is the OpenSubsonic-compatible endpoint. It saves the queue using
/// the new server-side queue schema but maintains API compatibility.
pub async fn save_play_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<SavePlayQueueParams>,
) -> Result<impl axum::response::IntoResponse> {
    // Use a transaction to ensure atomicity
    let mut tx = state.pool.begin().await?;

    // Delete existing queue entries for this user
    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;

    // Insert new queue entries
    for (position, song_id) in params.id.iter().enumerate() {
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position) VALUES (?, ?, ?)",
        )
        .bind(user.user_id)
        .bind(song_id)
        .bind(position as i64)
        .execute(&mut *tx)
        .await?;
    }

    // Find current index from current song ID
    let current_index = find_current_index(&params.id, params.current.as_deref());

    // Upsert the queue metadata using new schema
    sqlx::query(
        "INSERT INTO play_queues (user_id, source_type, current_index, position_ms, 
         is_shuffled, repeat_mode, created_at, updated_at, changed_by)
         VALUES (?, 'other', ?, ?, 0, 'off', datetime('now'), datetime('now'), ?)
         ON CONFLICT(user_id, session_id) DO UPDATE SET
            current_index = excluded.current_index,
            position_ms = excluded.position_ms,
            updated_at = datetime('now'),
            changed_by = excluded.changed_by",
    )
    .bind(user.user_id)
    .bind(current_index)
    .bind(params.position.unwrap_or(0))
    .bind(&user.client)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(format_ok_empty(user.format))
}

/// GET /rest/getPlayQueue - Get the saved play queue
///
/// This is the OpenSubsonic-compatible endpoint. It reads from the new
/// server-side queue schema but returns data in the OpenSubsonic format.
pub async fn get_play_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<PlayQueueResponse>> {
    // Get queue metadata from new schema
    let queue_meta: Option<(i64, i64, chrono::DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT current_index, position_ms, updated_at, changed_by FROM play_queues WHERE user_id = ? LIMIT 1",
    )
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;

    // Get queue entries with song data
    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.user_id = ?
         ORDER BY pqe.queue_position ASC",
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

    let song_responses: Vec<crate::api::common::models::SongResponse> = songs
        .iter()
        .map(|song| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            song_to_response(song.clone(), None, starred, user_rating)
        })
        .collect();

    // Convert from new schema to OpenSubsonic format
    let (current, position, changed, changed_by) =
        if let Some((current_index, position_ms, updated_at, by)) = queue_meta {
            // Get the current song ID from the queue entries
            let current_song_id = if (current_index as usize) < songs.len() {
                Some(songs[current_index as usize].id.clone())
            } else {
                None
            };
            (
                current_song_id,
                Some(position_ms),
                Some(format_datetime_iso(updated_at)),
                Some(by),
            )
        } else {
            (None, None, None, None)
        };

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
