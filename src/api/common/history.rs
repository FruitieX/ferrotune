//! Common history utilities.
//!
//! This module provides shared functionality for play history operations,
//! used by both Subsonic and Ferrotune APIs.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{SongPlayStats, SongResponse};
use crate::api::common::sorting::filter_and_sort_songs;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso;
use crate::api::subsonic::inline_thumbnails::get_song_thumbnails_base64;
use crate::db::models::{ItemType, Song};
use crate::thumbnails::ThumbnailSize;
use std::collections::HashMap;

/// Play history entry with song and played_at timestamp
pub struct PlayHistoryItem {
    pub song: SongResponse,
    pub played_at: String,
}

/// Parameters for fetching play history
pub struct PlayHistoryParams {
    pub size: i64,
    pub offset: i64,
    pub filter: Option<String>,
    pub sort: Option<String>,
    pub sort_dir: Option<String>,
    pub inline_size: Option<ThumbnailSize>,
}

impl Default for PlayHistoryParams {
    fn default() -> Self {
        Self {
            size: 50,
            offset: 0,
            filter: None,
            sort: None,
            sort_dir: None,
            inline_size: None,
        }
    }
}

/// Result of fetching play history
pub struct PlayHistoryResult {
    pub entries: Vec<PlayHistoryItem>,
    pub total: i64,
}

/// Fetch play history for a user with optional filtering, sorting, and thumbnails
pub async fn fetch_play_history(
    database: &crate::db::Database,
    user_id: i64,
    params: PlayHistoryParams,
) -> crate::error::Result<PlayHistoryResult> {
    // Step 1: Aggregate scrobbles per song (most recent N).
    let aggregates = crate::db::repo::history::list_recent_song_aggregates(
        database.conn(),
        user_id,
        params.size,
        params.offset,
    )
    .await?;

    // Step 2: Fetch song metadata for the resulting ids.
    let ordered_ids: Vec<String> = aggregates.iter().map(|a| a.song_id.clone()).collect();
    let song_rows =
        crate::db::repo::history::fetch_songs_by_ids(database.conn(), &ordered_ids).await?;

    // Merge aggregates into songs preserving the aggregate ordering.
    let mut song_by_id: HashMap<String, Song> =
        song_rows.into_iter().map(|s| (s.id.clone(), s)).collect();
    let songs: Vec<Song> = aggregates
        .into_iter()
        .filter_map(|agg| {
            song_by_id.remove(&agg.song_id).map(|mut s| {
                s.play_count = Some(agg.play_count);
                s.last_played = Some(agg.last_played);
                s
            })
        })
        .collect();

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get total count of unique songs in history
    let total: i64 =
        crate::db::repo::history::count_distinct_played_songs(database.conn(), user_id).await?;

    // Get starred status and ratings for all songs in the result
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails: HashMap<String, String> = if let Some(size) = params.inline_size {
        let song_thumbnail_data: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|s| (s.id.clone(), s.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_thumbnail_data, size).await
    } else {
        HashMap::new()
    };

    // Convert to response format
    let entries: Vec<PlayHistoryItem> = songs
        .into_iter()
        .map(|song| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            let cover_art_data = thumbnails.get(&song.id).cloned();
            let played_at = song
                .last_played
                .map(format_datetime_iso)
                .unwrap_or_default();
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song.last_played.map(format_datetime_iso),
            };
            PlayHistoryItem {
                song: song_to_response_with_stats(
                    song,
                    None,
                    starred,
                    user_rating,
                    Some(play_stats),
                    None,
                    cover_art_data,
                ),
                played_at,
            }
        })
        .collect();

    Ok(PlayHistoryResult { entries, total })
}
