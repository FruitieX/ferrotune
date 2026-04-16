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
use crate::db::DatabaseHandle;
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
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    params: PlayHistoryParams,
) -> crate::error::Result<PlayHistoryResult> {
    let songs: Vec<Song> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(
                        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                                            s.track_number, s.disc_number, s.year, s.genre, s.duration,
                                            s.bitrate, s.file_path, s.file_size, s.file_format,
                                            s.created_at, s.updated_at, s.cover_art_hash,
                                            s.cover_art_width, s.cover_art_height,
                                            s.original_replaygain_track_gain, s.original_replaygain_track_peak,
                                            s.computed_replaygain_track_gain, s.computed_replaygain_track_peak,
                                            pc.play_count,
                                            sc.played_at as last_played,
                                            NULL as starred_at
                             FROM scrobbles sc
                             INNER JOIN songs s ON sc.song_id = s.id
                             INNER JOIN artists ar ON s.artist_id = ar.id
                             LEFT JOIN albums al ON s.album_id = al.id
                             LEFT JOIN (
                                     SELECT song_id, COUNT(*) as play_count
                                     FROM scrobbles WHERE submission = 1 AND user_id = ?
                                     GROUP BY song_id
                             ) pc ON s.id = pc.song_id
                             WHERE sc.user_id = ? AND sc.submission = 1
                                 AND sc.played_at = (
                                     SELECT MAX(sc2.played_at)
                                     FROM scrobbles sc2
                                     WHERE sc2.song_id = sc.song_id AND sc2.user_id = sc.user_id AND sc2.submission = 1
                                 )
                             ORDER BY sc.played_at DESC
                             LIMIT ? OFFSET ?"#,
                )
                .bind(user_id)
                .bind(user_id)
                .bind(params.size)
                .bind(params.offset)
                .fetch_all(pool)
                .await?
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query_as(
                        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                                            s.track_number, s.disc_number, s.year, s.genre, s.duration,
                                            s.bitrate, s.file_path, s.file_size, s.file_format,
                                            s.created_at, s.updated_at, s.cover_art_hash,
                                            s.cover_art_width, s.cover_art_height,
                                            s.original_replaygain_track_gain, s.original_replaygain_track_peak,
                                            s.computed_replaygain_track_gain, s.computed_replaygain_track_peak,
                                            pc.play_count,
                                            sc.played_at as last_played,
                                            NULL::timestamptz as starred_at
                             FROM scrobbles sc
                             INNER JOIN songs s ON sc.song_id = s.id
                             INNER JOIN artists ar ON s.artist_id = ar.id
                             LEFT JOIN albums al ON s.album_id = al.id
                             LEFT JOIN (
                                     SELECT song_id, COUNT(*)::BIGINT as play_count
                                     FROM scrobbles WHERE submission = TRUE AND user_id = $1
                                     GROUP BY song_id
                             ) pc ON s.id = pc.song_id
                             WHERE sc.user_id = $2 AND sc.submission = TRUE
                                 AND sc.played_at = (
                                     SELECT MAX(sc2.played_at)
                                     FROM scrobbles sc2
                                     WHERE sc2.song_id = sc.song_id AND sc2.user_id = sc.user_id AND sc2.submission = TRUE
                                 )
                             ORDER BY sc.played_at DESC
                             LIMIT $3 OFFSET $4"#,
                )
                .bind(user_id)
                .bind(user_id)
                .bind(params.size)
                .bind(params.offset)
                .fetch_all(pool)
                .await?
    };

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get total count of unique songs in history
    let total: i64 = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_scalar(
            "SELECT COUNT(DISTINCT song_id) FROM scrobbles WHERE user_id = ? AND submission = 1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    } else {
        let pool = database.postgres_pool()?;
        sqlx::query_scalar(
            "SELECT COUNT(DISTINCT song_id) FROM scrobbles WHERE user_id = $1 AND submission = TRUE",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    };

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
