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
    // Use a deterministic session ID for playqueue save/restore
    let session_id = format!("playqueue-{}", user.user_id);

    // Find current index from current song ID
    let current_index = find_current_index(&params.id, params.current.as_deref());

    crate::db::queries::create_queue_for_session(
        &state.database,
        user.user_id,
        &session_id,
        "other",
        None,
        None,
        &params.id,
        None,
        current_index,
        false,
        None,
        None,
        "off",
        None,
        None,
        &user.client,
    )
    .await?;

    if let Some(position_ms) = params.position {
        crate::db::queries::update_queue_position_ms_by_session(
            &state.database,
            &session_id,
            position_ms,
        )
        .await?;
    }

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
    // Use a deterministic session ID for playqueue save/restore
    let session_id = format!("playqueue-{}", user.user_id);

    let queue_meta =
        crate::db::queries::get_play_queue_by_session(&state.database, &session_id, user.user_id)
            .await?;

    let songs: Vec<crate::db::models::Song> =
        crate::db::queries::get_queue_entries_with_songs_by_session(&state.database, &session_id)
            .await?
            .into_iter()
            .map(|entry| crate::db::models::Song {
                id: entry.id,
                title: entry.title,
                album_id: entry.album_id,
                album_name: entry.album_name,
                artist_id: entry.artist_id,
                artist_name: entry.artist_name,
                track_number: entry.track_number,
                disc_number: entry.disc_number,
                year: entry.year,
                genre: entry.genre,
                duration: entry.duration,
                bitrate: entry.bitrate,
                file_path: entry.file_path,
                file_size: entry.file_size,
                file_format: entry.file_format,
                created_at: entry.created_at,
                updated_at: entry.updated_at,
                play_count: entry.play_count,
                last_played: entry.last_played,
                starred_at: entry.starred_at,
                cover_art_hash: entry.cover_art_hash,
                cover_art_width: entry.cover_art_width,
                cover_art_height: entry.cover_art_height,
                original_replaygain_track_gain: entry.original_replaygain_track_gain,
                original_replaygain_track_peak: entry.original_replaygain_track_peak,
                computed_replaygain_track_gain: entry.computed_replaygain_track_gain,
                computed_replaygain_track_peak: entry.computed_replaygain_track_peak,
            })
            .collect();

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map =
        get_starred_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;
    let ratings_map =
        get_ratings_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;

    let song_responses: Vec<crate::api::common::models::SongResponse> = songs
        .iter()
        .map(|song| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            song_to_response(song.clone(), None, starred, user_rating)
        })
        .collect();

    // Convert from new schema to OpenSubsonic format
    let (current, position, changed, changed_by) = if let Some(queue) = queue_meta {
        // Get the current song ID from the queue entries
        let current_song_id = if (queue.current_index as usize) < songs.len() {
            Some(songs[queue.current_index as usize].id.clone())
        } else {
            None
        };
        (
            current_song_id,
            Some(queue.position_ms),
            Some(format_datetime_iso(queue.updated_at)),
            Some(queue.changed_by),
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
