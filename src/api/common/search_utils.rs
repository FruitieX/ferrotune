//! Common search post-processing utilities
//!
//! This module provides shared functions for post-processing search results
//! including fetching starred/rating maps and building response objects.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::search::{
    search_albums, search_artists, search_songs, AlbumSearchResult, ArtistSearchResult,
    SearchParams, SongSearchResult,
};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::{format_datetime_iso, format_datetime_iso_ms};
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_artist_thumbnails_base64, get_song_thumbnails_base64,
};
use crate::db::models::ItemType;
use crate::error::Result;
use crate::thumbnails::ThumbnailSize;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Post-process artist search results with starred/rating maps and thumbnails
pub async fn post_process_artists(
    pool: &SqlitePool,
    user_id: i64,
    artist_result: ArtistSearchResult,
    inline_size: Option<ThumbnailSize>,
) -> Result<Vec<ArtistResponse>> {
    let artist_ids: Vec<String> = artist_result.artists.iter().map(|a| a.id.clone()).collect();
    let artist_starred = get_starred_map(pool, user_id, ItemType::Artist, &artist_ids).await?;
    let artist_ratings = get_ratings_map(pool, user_id, ItemType::Artist, &artist_ids).await?;

    let artist_thumbnails = if let Some(size) = inline_size {
        get_artist_thumbnails_base64(pool, &artist_ids, size).await
    } else {
        HashMap::new()
    };

    let artist_responses: Vec<ArtistResponse> = artist_result
        .artists
        .into_iter()
        .map(|artist| ArtistResponse {
            id: artist.id.clone(),
            name: artist.name,
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
            cover_art_data: artist_thumbnails.get(&artist.id).cloned(),
            starred: artist_starred.get(&artist.id).cloned(),
            user_rating: artist_ratings.get(&artist.id).copied(),
        })
        .collect();

    Ok(artist_responses)
}

/// Post-process album search results with starred/rating maps and thumbnails
pub async fn post_process_albums(
    pool: &SqlitePool,
    user_id: i64,
    album_result: AlbumSearchResult,
    inline_size: Option<ThumbnailSize>,
) -> Result<Vec<AlbumResponse>> {
    let album_ids: Vec<String> = album_result.albums.iter().map(|a| a.id.clone()).collect();
    let album_starred = get_starred_map(pool, user_id, ItemType::Album, &album_ids).await?;
    let album_ratings = get_ratings_map(pool, user_id, ItemType::Album, &album_ids).await?;

    let album_thumbnails = if let Some(size) = inline_size {
        get_album_thumbnails_base64(pool, &album_ids, size).await
    } else {
        HashMap::new()
    };

    let album_responses: Vec<AlbumResponse> = album_result
        .albums
        .into_iter()
        .map(|album| {
            let created = format_datetime_iso_ms(album.created_at);
            AlbumResponse {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id.clone()),
                cover_art_data: album_thumbnails.get(&album.id).cloned(),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: album_starred.get(&album.id).cloned(),
                user_rating: album_ratings.get(&album.id).copied(),
            }
        })
        .collect();

    Ok(album_responses)
}

/// Post-process song search results with starred/rating maps and thumbnails
pub async fn post_process_songs(
    pool: &SqlitePool,
    user_id: i64,
    song_result: SongSearchResult,
    inline_size: Option<ThumbnailSize>,
) -> Result<Vec<SongResponse>> {
    let song_ids: Vec<String> = song_result.songs.iter().map(|s| s.id.clone()).collect();
    let song_starred = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let song_ratings = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails for songs if requested (uses album thumbnails)
    let song_thumbnail_data: Vec<(String, Option<String>)> = song_result
        .songs
        .iter()
        .map(|s| (s.id.clone(), s.album_id.clone()))
        .collect();
    let song_thumbnails = if let Some(size) = inline_size {
        get_song_thumbnails_base64(pool, &song_thumbnail_data, size).await
    } else {
        HashMap::new()
    };

    let song_responses: Vec<SongResponse> = song_result
        .songs
        .into_iter()
        .map(|song| {
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song.last_played.map(format_datetime_iso),
            };
            let cover_art_data = song_thumbnails.get(&song.id).cloned();
            song_to_response_with_stats(
                song.clone(),
                None, // Album info already embedded in song
                song_starred.get(&song.id).cloned(),
                song_ratings.get(&song.id).copied(),
                Some(play_stats),
                None,
                cover_art_data,
            )
        })
        .collect();

    Ok(song_responses)
}

/// Full search result with counts
pub struct SearchResults {
    pub artist_responses: Vec<ArtistResponse>,
    pub album_responses: Vec<AlbumResponse>,
    pub song_responses: Vec<SongResponse>,
    pub artist_total: Option<i64>,
    pub album_total: Option<i64>,
    pub song_total: Option<i64>,
}

/// Execute full search with post-processing
#[allow(clippy::too_many_arguments)]
pub async fn execute_search(
    pool: &SqlitePool,
    user_id: i64,
    query: &str,
    params: &SearchParams,
    artist_count: i64,
    artist_offset: i64,
    album_count: i64,
    album_offset: i64,
    song_count: i64,
    song_offset: i64,
    inline_size: Option<ThumbnailSize>,
) -> Result<SearchResults> {
    // Search artists
    let artist_result =
        search_artists(pool, user_id, query, params, artist_count, artist_offset).await?;
    let artist_total = artist_result.total;
    let artist_responses = post_process_artists(pool, user_id, artist_result, inline_size).await?;

    // Search albums
    let album_result =
        search_albums(pool, user_id, query, params, album_count, album_offset).await?;
    let album_total = album_result.total;
    let album_responses = post_process_albums(pool, user_id, album_result, inline_size).await?;

    // Search songs
    let song_result = search_songs(pool, user_id, query, params, song_count, song_offset).await?;
    let song_total = song_result.total;
    let song_responses = post_process_songs(pool, user_id, song_result, inline_size).await?;

    Ok(SearchResults {
        artist_responses,
        album_responses,
        song_responses,
        artist_total,
        album_total,
        song_total,
    })
}
