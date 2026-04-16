//! Inline thumbnail support for API responses
//!
//! This module provides functionality to include base64-encoded thumbnails
//! directly in API responses, reducing the number of HTTP requests needed
//! to display cover art in list views.
//!
//! The client can request inline thumbnails by adding:
//! - `inlineImages=small` - Include small thumbnails (for list items, rows)
//! - `inlineImages=medium` - Include medium thumbnails (for cards, dialogs)
//!
//! Thumbnails are returned as base64-encoded JPEG data in the `coverArtData` field.

#![allow(dead_code)]

use crate::db::DatabaseHandle;
use crate::thumbnails::ThumbnailSize;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Query parameter for requesting inline thumbnails
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InlineImagesParam {
    /// Size of inline thumbnails: "small", "medium", or empty (no inline images)
    #[serde(default)]
    pub inline_images: Option<String>,
}

impl InlineImagesParam {
    /// Parse the inline_images parameter into a ThumbnailSize
    pub fn get_size(&self) -> Option<ThumbnailSize> {
        match self.inline_images.as_deref() {
            Some("small") | Some("s") => Some(ThumbnailSize::Small),
            Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
            _ => None,
        }
    }
}

/// Fetch thumbnails for multiple albums and return as base64-encoded map
pub async fn get_album_thumbnails_base64(
    database: &(impl DatabaseHandle + ?Sized),
    album_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if album_ids.is_empty() {
        return HashMap::new();
    }

    let pool = match database.sqlite_pool() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching album thumbnails requires a SQLite-backed database: {}",
                e
            );
            return HashMap::new();
        }
    };

    let column = match size {
        ThumbnailSize::Small => "small",
        ThumbnailSize::Medium => "medium",
        ThumbnailSize::Large => return HashMap::new(), // No inline for large
    };

    // Build query with placeholders
    let placeholders: Vec<&str> = album_ids.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT a.id, t.{} FROM albums a 
         INNER JOIN cover_art_thumbnails t ON a.cover_art_hash = t.hash 
         WHERE a.id IN ({})",
        column,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, Vec<u8>)>(&query);
    for id in album_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, Vec<u8>)> = match query_builder.fetch_all(pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to fetch album thumbnails: {}", e);
            return HashMap::new();
        }
    };

    results
        .into_iter()
        .map(|(album_id, data)| (album_id, BASE64.encode(&data)))
        .collect()
}

/// Get a single album thumbnail as base64
pub async fn get_album_thumbnail_base64(
    database: &(impl DatabaseHandle + ?Sized),
    album_id: &str,
    size: ThumbnailSize,
) -> Option<String> {
    let column = match size {
        ThumbnailSize::Small => "small",
        ThumbnailSize::Medium => "medium",
        ThumbnailSize::Large => return None,
    };

    let pool = match database.sqlite_pool() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching album thumbnail requires a SQLite-backed database: {}",
                e
            );
            return None;
        }
    };

    let query = format!(
        "SELECT t.{} FROM albums a 
         INNER JOIN cover_art_thumbnails t ON a.cover_art_hash = t.hash 
         WHERE a.id = ?",
        column
    );

    let result: Option<(Vec<u8>,)> = sqlx::query_as(&query)
        .bind(album_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

    result.map(|(data,)| BASE64.encode(&data))
}

/// Get thumbnails for multiple artists (uses their first album's thumbnail)
pub async fn get_artist_thumbnails_base64(
    database: &(impl DatabaseHandle + ?Sized),
    artist_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if artist_ids.is_empty() {
        return HashMap::new();
    }

    let pool = match database.sqlite_pool() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching artist thumbnails requires a SQLite-backed database: {}",
                e
            );
            return HashMap::new();
        }
    };

    let column = match size {
        ThumbnailSize::Small => "small",
        ThumbnailSize::Medium => "medium",
        ThumbnailSize::Large => return HashMap::new(),
    };

    // Build query to get first album's thumbnail for each artist
    let placeholders: Vec<&str> = artist_ids.iter().map(|_| "?").collect();
    let query = format!(
        r#"
        SELECT ar.id, t.{column}
        FROM artists ar
        LEFT JOIN albums a ON a.artist_id = ar.id AND a.cover_art_hash IS NOT NULL
        LEFT JOIN cover_art_thumbnails t ON (ar.cover_art_hash = t.hash OR a.cover_art_hash = t.hash)
        WHERE ar.id IN ({placeholders})
        GROUP BY ar.id
        HAVING t.{column} IS NOT NULL
        "#,
        column = column,
        placeholders = placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, Vec<u8>)>(&query);
    for id in artist_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, Vec<u8>)> = match query_builder.fetch_all(pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to fetch artist thumbnails: {}", e);
            return HashMap::new();
        }
    };

    results
        .into_iter()
        .map(|(artist_id, data)| (artist_id, BASE64.encode(&data)))
        .collect()
}

/// Get thumbnails for songs (uses song's own cover art, falls back to album's cover art)
pub async fn get_song_thumbnails_base64(
    database: &(impl DatabaseHandle + ?Sized),
    songs: &[(String, Option<String>)], // (song_id, album_id)
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if songs.is_empty() {
        return HashMap::new();
    }

    let pool = match database.sqlite_pool() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching song thumbnails requires a SQLite-backed database: {}",
                e
            );
            return HashMap::new();
        }
    };

    let column = match size {
        ThumbnailSize::Small => "small",
        ThumbnailSize::Medium => "medium",
        ThumbnailSize::Large => return HashMap::new(),
    };

    // First, try to get thumbnails from song's own cover_art_hash
    let song_ids: Vec<String> = songs.iter().map(|(id, _)| id.clone()).collect();
    let placeholders: Vec<&str> = song_ids.iter().map(|_| "?").collect();

    let query = format!(
        "SELECT s.id, t.{} FROM songs s 
         INNER JOIN cover_art_thumbnails t ON s.cover_art_hash = t.hash 
         WHERE s.id IN ({})",
        column,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, Vec<u8>)>(&query);
    for id in &song_ids {
        query_builder = query_builder.bind(id);
    }

    let song_results: Vec<(String, Vec<u8>)> = match query_builder.fetch_all(pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to fetch song thumbnails: {}", e);
            Vec::new()
        }
    };

    let mut result: HashMap<String, String> = song_results
        .into_iter()
        .map(|(song_id, data)| (song_id, BASE64.encode(&data)))
        .collect();

    // For songs that don't have their own cover art, fall back to album thumbnails
    let songs_needing_album_fallback: Vec<&(String, Option<String>)> = songs
        .iter()
        .filter(|(song_id, _)| !result.contains_key(song_id))
        .collect();

    if !songs_needing_album_fallback.is_empty() {
        // Collect unique album IDs for songs needing fallback
        let album_ids: Vec<String> = songs_needing_album_fallback
            .iter()
            .filter_map(|(_, album_id)| album_id.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        // Get album thumbnails
        let album_thumbnails = get_album_thumbnails_base64(pool, &album_ids, size).await;

        // Map remaining songs to their album's thumbnail
        for (song_id, album_id) in songs_needing_album_fallback {
            if let Some(aid) = album_id {
                if let Some(thumb) = album_thumbnails.get(aid) {
                    result.insert(song_id.clone(), thumb.clone());
                }
            }
        }
    }

    result
}

/// Generate a tiled playlist thumbnail from album thumbnails and return as base64
#[allow(unused_imports)]
pub async fn get_playlist_thumbnail_base64(
    database: &(impl DatabaseHandle + ?Sized),
    playlist_id: &str,
    size: ThumbnailSize,
) -> Option<String> {
    use image::{imageops::FilterType, DynamicImage, GenericImage, ImageFormat, RgbImage};
    use std::io::Cursor;

    let pool = match database.sqlite_pool() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching playlist thumbnail requires a SQLite-backed database: {}",
                e
            );
            return None;
        }
    };

    // Get medium thumbnails for tiling (better quality for compositing)
    let tile_size_enum = ThumbnailSize::Medium;
    let column = "medium";

    let query = format!(
        "SELECT t.hash, t.{} 
         FROM songs s
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         INNER JOIN cover_art_thumbnails t ON s.cover_art_hash = t.hash
         WHERE ps.playlist_id = ? AND s.cover_art_hash IS NOT NULL
         ORDER BY ps.position
         LIMIT 4",
        column
    );

    let mut query_builder = sqlx::query_as::<_, (String, Vec<u8>)>(&query);
    query_builder = query_builder.bind(playlist_id);

    let results: Vec<(String, Vec<u8>)> = query_builder.fetch_all(pool).await.ok()?;

    if results.is_empty() {
        return None;
    }

    // If only one cover, return it directly (resized if needed)
    if results.len() == 1 {
        let data = &results[0].1;
        if size == tile_size_enum {
            return Some(BASE64.encode(data));
        }
        // Resize to requested size
        let resized = tokio::task::spawn_blocking({
            let data = data.clone();
            let target_size = match size {
                ThumbnailSize::Small => crate::thumbnails::THUMBNAIL_SMALL,
                ThumbnailSize::Medium => crate::thumbnails::THUMBNAIL_MEDIUM,
                ThumbnailSize::Large => return None,
            };
            move || resize_image(&data, target_size)
        })
        .await
        .ok()??;
        return Some(BASE64.encode(&resized));
    }

    // Generate tiled image
    let target_size = match size {
        ThumbnailSize::Small => crate::thumbnails::THUMBNAIL_SMALL * 2, // 160px total
        ThumbnailSize::Medium => crate::thumbnails::THUMBNAIL_MEDIUM,   // 256px total
        ThumbnailSize::Large => return None,
    };

    let covers: Vec<Vec<u8>> = results.into_iter().map(|(_, data)| data).collect();

    let tiled = tokio::task::spawn_blocking(move || generate_tiled_thumbnail(covers, target_size))
        .await
        .ok()??;

    Some(BASE64.encode(&tiled))
}

/// Get thumbnails for multiple playlists
pub async fn get_playlist_thumbnails_base64(
    database: &(impl DatabaseHandle + ?Sized),
    playlist_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let pool = match database.sqlite_pool_cloned() {
        Ok(pool) => pool,
        Err(e) => {
            tracing::warn!(
                "Fetching playlist thumbnails requires a SQLite-backed database: {}",
                e
            );
            return result;
        }
    };

    // Process playlists in parallel (limited concurrency)
    let futures: Vec<_> = playlist_ids
        .iter()
        .map(|id| {
            let pool = pool.clone();
            let id = id.clone();
            async move {
                let thumb = get_playlist_thumbnail_base64(&pool, &id, size).await;
                (id, thumb)
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    for (id, thumb) in results {
        if let Some(t) = thumb {
            result.insert(id, t);
        }
    }

    result
}

/// Resize an image to target size
fn resize_image(data: &[u8], size: u32) -> Option<Vec<u8>> {
    use image::{imageops::FilterType, ImageFormat};
    use std::io::Cursor;

    let img = image::load_from_memory(data).ok()?;
    let resized = img.resize_to_fill(size, size, FilterType::Triangle);

    let mut buffer = Cursor::new(Vec::new());
    resized.write_to(&mut buffer, ImageFormat::Jpeg).ok()?;

    Some(buffer.into_inner())
}

/// Generate a 2x2 tiled thumbnail from cover images
fn generate_tiled_thumbnail(covers: Vec<Vec<u8>>, target_size: u32) -> Option<Vec<u8>> {
    use image::{imageops::FilterType, DynamicImage, GenericImage, ImageFormat, RgbImage};
    use std::io::Cursor;

    let tile_size = target_size / 2;

    let mut tiles: Vec<RgbImage> = Vec::new();
    for cover_data in &covers {
        if let Ok(img) = image::load_from_memory(cover_data) {
            let resized = img.resize_to_fill(tile_size, tile_size, FilterType::Triangle);
            tiles.push(resized.to_rgb8());
        }
    }

    if tiles.is_empty() {
        return None;
    }

    let mut output = RgbImage::new(target_size, target_size);

    // Fill with black
    for pixel in output.pixels_mut() {
        *pixel = image::Rgb([0, 0, 0]);
    }

    let positions: [(u32, u32); 4] = [
        (0, 0),
        (tile_size, 0),
        (0, tile_size),
        (tile_size, tile_size),
    ];

    let tile_count = tiles.len();
    for (i, &(x, y)) in positions.iter().enumerate() {
        let tile_idx = match tile_count {
            1 => 0,
            2 => i % 2,
            3 => {
                if i == 3 {
                    0
                } else {
                    i
                }
            }
            _ => i,
        };

        if tile_idx < tiles.len() {
            let _ = output.copy_from(&tiles[tile_idx], x, y);
        }
    }

    let mut buffer = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(output)
        .write_to(&mut buffer, ImageFormat::Jpeg)
        .ok()?;

    Some(buffer.into_inner())
}
