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

use crate::thumbnails::ThumbnailSize;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn thumbnail_is_medium(size: ThumbnailSize) -> Option<bool> {
    match size {
        ThumbnailSize::Small => Some(false),
        ThumbnailSize::Medium => Some(true),
        ThumbnailSize::Large => None,
    }
}

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

fn thumbnail_column(size: ThumbnailSize) -> Option<&'static str> {
    match size {
        ThumbnailSize::Small => Some("small"),
        ThumbnailSize::Medium => Some("medium"),
        ThumbnailSize::Large => None,
    }
}

fn encode_thumbnail_rows(rows: Vec<(String, Vec<u8>)>) -> HashMap<String, String> {
    rows.into_iter()
        .map(|(id, data)| (id, BASE64.encode(&data)))
        .collect()
}

/// Fetch thumbnails for multiple albums and return as base64-encoded map
pub async fn get_album_thumbnails_base64(
    database: &crate::db::Database,
    album_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if album_ids.is_empty() {
        return HashMap::new();
    }
    let Some(medium) = thumbnail_is_medium(size) else {
        return HashMap::new();
    };
    let rows = match crate::db::repo::coverart::fetch_album_thumbnails(database, album_ids, medium)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("Failed to fetch album thumbnails: {}", e);
            return HashMap::new();
        }
    };
    encode_thumbnail_rows(rows)
}

/// Get a single album thumbnail as base64
pub async fn get_album_thumbnail_base64(
    database: &crate::db::Database,
    album_id: &str,
    size: ThumbnailSize,
) -> Option<String> {
    let mut thumbnails = get_album_thumbnails_base64(database, &[album_id.to_string()], size).await;
    thumbnails.remove(album_id)
}

/// Get thumbnails for multiple artists (uses their first album's thumbnail)
pub async fn get_artist_thumbnails_base64(
    database: &crate::db::Database,
    artist_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if artist_ids.is_empty() {
        return HashMap::new();
    }
    let Some(medium) = thumbnail_is_medium(size) else {
        return HashMap::new();
    };

    // Step 1: artists with their own cover_art_hash
    let own_rows =
        match crate::db::repo::coverart::fetch_artist_own_thumbnails(database, artist_ids, medium)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("Failed to fetch artist thumbnails: {}", e);
                Vec::new()
            }
        };
    let mut result: HashMap<String, Vec<u8>> = own_rows.into_iter().collect();

    // Step 2: album fallback for artists not yet resolved
    let remaining: Vec<String> = artist_ids
        .iter()
        .filter(|id| !result.contains_key(*id))
        .cloned()
        .collect();
    if !remaining.is_empty() {
        match crate::db::repo::coverart::fetch_album_thumbnails_by_artists(
            database, &remaining, medium,
        )
        .await
        {
            Ok(rows) => {
                for (artist_id, blob) in rows {
                    result.entry(artist_id).or_insert(blob);
                }
            }
            Err(e) => tracing::warn!("Failed to fetch album fallback thumbnails: {}", e),
        }
    }

    encode_thumbnail_rows(result.into_iter().collect())
}

/// Get thumbnails for songs (uses song's own cover art, falls back to album's cover art)
pub async fn get_song_thumbnails_base64(
    database: &crate::db::Database,
    songs: &[(String, Option<String>)], // (song_id, album_id)
    size: ThumbnailSize,
) -> HashMap<String, String> {
    if songs.is_empty() {
        return HashMap::new();
    }
    let Some(medium) = thumbnail_is_medium(size) else {
        return HashMap::new();
    };

    // First, try to get thumbnails from song's own cover_art_hash
    let song_ids: Vec<String> = songs.iter().map(|(id, _)| id.clone()).collect();
    let song_rows =
        match crate::db::repo::coverart::fetch_song_own_thumbnails(database, &song_ids, medium)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("Failed to fetch song thumbnails: {}", e);
                Vec::new()
            }
        };
    let mut result = encode_thumbnail_rows(song_rows);

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
        let album_thumbnails = get_album_thumbnails_base64(database, &album_ids, size).await;

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
    database: &crate::db::Database,
    playlist_id: &str,
    size: ThumbnailSize,
) -> Option<String> {
    use image::{imageops::FilterType, DynamicImage, GenericImage, ImageFormat, RgbImage};
    use std::io::Cursor;

    // Get medium thumbnails for tiling (better quality for compositing)
    let tile_size_enum = ThumbnailSize::Medium;

    let rows = crate::db::repo::coverart::fetch_playlist_song_thumbnails(
        database,
        playlist_id,
        true, // medium
        4,
    )
    .await
    .ok()?;
    let results: Vec<(String, Vec<u8>)> = rows;

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
    database: &crate::db::Database,
    playlist_ids: &[String],
    size: ThumbnailSize,
) -> HashMap<String, String> {
    let mut result = HashMap::new();

    let futures: Vec<_> = playlist_ids
        .iter()
        .map(|id| async move {
            let thumb = get_playlist_thumbnail_base64(database, id, size).await;
            (id.clone(), thumb)
        })
        .collect();

    for (id, thumb) in futures::future::join_all(futures).await {
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
