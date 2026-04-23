//! Common starring and rating utilities.
//!
//! This module provides shared functionality for starring/favoriting items
//! and rating operations, used by both Subsonic and Ferrotune APIs.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::utils::format_datetime_iso;
use crate::db::models::ItemType;
use std::collections::HashMap;

/// Get starred timestamps for multiple items of a given type for a user
pub async fn get_starred_map(
    database: &crate::db::Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, String>> {
    crate::db::repo::starring::get_starred_map(database, user_id, item_type, item_ids).await
}

/// Get ratings for multiple items of a given type for a user
pub async fn get_ratings_map(
    database: &crate::db::Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, i32>> {
    crate::db::repo::starring::get_ratings_map(database, user_id, item_type, item_ids).await
}

// ============================================================================
// Core starring/unstarring operations
// ============================================================================

/// Star multiple items of different types
pub async fn star_items(
    database: &crate::db::Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    crate::db::repo::starring::star_items(database, user_id, song_ids, album_ids, artist_ids).await
}

/// Unstar multiple items of different types
pub async fn unstar_items(
    database: &crate::db::Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    crate::db::repo::starring::unstar_items(database, user_id, song_ids, album_ids, artist_ids)
        .await
}

/// Determine item type by checking which table contains the ID
pub async fn detect_item_type(
    database: &crate::db::Database,
    id: &str,
) -> crate::error::Result<ItemType> {
    if crate::db::repo::browse::get_song_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Song)
    } else if crate::db::repo::browse::get_album_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Album)
    } else if crate::db::repo::browse::get_artist_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Artist)
    } else {
        Err(crate::error::Error::NotFound(format!(
            "Item {} not found",
            id
        )))
    }
}

/// Set or remove a rating for an item
pub async fn set_item_rating(
    database: &crate::db::Database,
    user_id: i64,
    id: &str,
    rating: i32,
) -> crate::error::Result<()> {
    let item_type = detect_item_type(database, id).await?;

    crate::db::repo::starring::set_item_rating(database, user_id, item_type, id, rating).await
}

// ============================================================================
// Fetch starred content
// ============================================================================

/// Fetch all starred content for a user (artists, albums, songs)
/// This is the shared implementation used by both getStarred and getStarred2 endpoints
pub async fn fetch_starred_content(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<(Vec<ArtistResponse>, Vec<AlbumResponse>, Vec<SongResponse>)> {
    let starred_artists =
        crate::db::repo::starring::list_starred_items(database, user_id, ItemType::Artist).await?;

    let artist_ids: Vec<String> = starred_artists
        .iter()
        .map(|(item_id, _)| item_id.clone())
        .collect();
    let artist_ratings = get_ratings_map(database, user_id, ItemType::Artist, &artist_ids).await?;

    let mut artist_responses = Vec::new();
    for row in starred_artists {
        if let Some(artist) = crate::db::repo::browse::get_artist_by_id(database, &row.0).await? {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                song_count: Some(artist.song_count),
                cover_art: Some(artist.id.clone()),
                cover_art_data: None,
                starred: Some(format_datetime_iso(row.1)),
                user_rating: artist_ratings.get(&artist.id).copied(),
            });
        }
    }

    let starred_albums =
        crate::db::repo::starring::list_starred_items(database, user_id, ItemType::Album).await?;

    let album_ids: Vec<String> = starred_albums
        .iter()
        .map(|(item_id, _)| item_id.clone())
        .collect();
    let album_ratings = get_ratings_map(database, user_id, ItemType::Album, &album_ids).await?;

    let mut album_responses = Vec::new();
    for row in starred_albums {
        if let Some(album) = crate::db::repo::browse::get_album_by_id(database, &row.0).await? {
            use crate::api::common::utils::format_datetime_iso_ms;
            let created = format_datetime_iso_ms(album.created_at);
            album_responses.push(AlbumResponse {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id.clone()),
                cover_art_data: None,
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: Some(format_datetime_iso(row.1)),
                user_rating: album_ratings.get(&album.id).copied(),
                played: None,
            });
        }
    }

    // Starred songs: fetch accessible starred (song_id, starred_at), then load
    // song metadata and aggregated play stats, then stitch them together in
    // starred order.
    let starred_song_rows =
        crate::db::repo::starring::list_starred_accessible_songs(database, user_id).await?;
    let ordered_song_ids: Vec<String> =
        starred_song_rows.iter().map(|(id, _)| id.clone()).collect();
    let song_rows =
        crate::db::repo::history::fetch_songs_by_ids(database.conn(), &ordered_song_ids).await?;
    let play_stats =
        crate::db::repo::starring::batch_song_play_stats(database, user_id, &ordered_song_ids)
            .await?;
    let mut song_by_id: HashMap<String, crate::db::models::Song> =
        song_rows.into_iter().map(|s| (s.id.clone(), s)).collect();
    let starred_songs: Vec<crate::db::models::Song> = starred_song_rows
        .into_iter()
        .filter_map(|(song_id, starred_at)| {
            song_by_id.remove(&song_id).map(|mut s| {
                if let Some((pc, lp)) = play_stats.get(&song_id).copied() {
                    s.play_count = Some(pc);
                    s.last_played = Some(lp);
                }
                s.starred_at = Some(starred_at);
                s
            })
        })
        .collect();

    let song_ids: Vec<String> = starred_songs.iter().map(|s| s.id.clone()).collect();
    let song_ratings = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();
    for song in starred_songs {
        let song_id = song.id.clone();
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };
        let starred = song.starred_at.map(format_datetime_iso);
        let user_rating = song_ratings.get(&song_id).copied();
        let play_stats = SongPlayStats {
            play_count: song.play_count,
            last_played: song.last_played.map(format_datetime_iso),
        };
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            None,
        ));
    }

    Ok((artist_responses, album_responses, song_responses))
}
