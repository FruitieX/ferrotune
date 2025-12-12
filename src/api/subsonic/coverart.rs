//! Cover art endpoint with thumbnail support
//!
//! This endpoint serves album cover art at three size tiers:
//! - Small: Pre-generated thumbnails from database (for list items, rows)
//! - Medium: Pre-generated thumbnails from database (for cards, dialogs)
//! - Large/Original: Fetched from media files on demand
//!
//! The client can request a specific size using:
//! - `size=small` / `size=s` - Small thumbnail
//! - `size=medium` / `size=m` - Medium thumbnail
//! - `size=large` / `size=l` / `size=original` - Original size
//! - Numeric size (backwards compatible): mapped to nearest tier

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, Result};
use crate::thumbnails::ThumbnailSize;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::Response,
};
use image::{imageops::FilterType, ImageFormat};
use serde::Deserialize;
use std::io::Cursor;
use std::sync::Arc;

/// Cache-Control header for cover art responses (30 days)
/// Cover art is content-addressable (hash-based), so aggressive caching is safe.
const COVER_ART_CACHE_HEADER: &str = "public, max-age=2592000";

#[derive(Deserialize)]
pub struct CoverArtParams {
    id: String,
    /// Size can be either numeric (for backwards compatibility) or
    /// a string like "small", "medium", "large"
    size: Option<String>,
}

impl CoverArtParams {
    /// Parse the size parameter into a ThumbnailSize enum
    fn get_thumbnail_size(&self) -> ThumbnailSize {
        match &self.size {
            None => ThumbnailSize::Large, // Default to original
            Some(s) => {
                // Try parsing as string first
                if let Some(size) = ThumbnailSize::from_str(s) {
                    return size;
                }
                // Try parsing as number for backwards compatibility
                if let Ok(num) = s.parse::<u32>() {
                    return ThumbnailSize::from_size(num);
                }
                ThumbnailSize::Large // Default fallback
            }
        }
    }
}

pub async fn get_cover_art(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CoverArtParams>,
) -> Result<Response> {
    // Handle empty or missing ID
    if params.id.is_empty() {
        return Err(Error::NotFound("No cover art ID provided".to_string()));
    }

    let requested_size = params.get_thumbnail_size();

    // For albums, try to use pre-generated thumbnails
    // IDs can have prefixes (al-, so-, ar-, pl-) or be plain UUIDs
    let image_data = if params.id.starts_with("al-") {
        get_album_cover_with_thumbnails(&state, &params.id, requested_size).await?
    } else if params.id.starts_with("so-") {
        // Song - get album ID and use its thumbnail if available
        get_song_cover_with_thumbnails(&state, &params.id, requested_size).await?
    } else if params.id.starts_with("ar-") {
        // Artist - use first album's thumbnail
        get_artist_cover_with_thumbnails(&state, &params.id, requested_size).await?
    } else if params.id.starts_with("pl-") {
        // Playlist - generate tiled cover art
        get_playlist_cover_art(&state, &params.id, requested_size).await?
    } else {
        // No prefix - try to infer entity type by checking if ID exists
        // Try album first (most common for cover art), then song
        if let Ok(data) = get_album_cover_with_thumbnails(&state, &params.id, requested_size).await
        {
            data
        } else if let Ok(data) =
            get_song_cover_with_thumbnails(&state, &params.id, requested_size).await
        {
            data
        } else {
            return Err(Error::NotFound(format!(
                "Cover art not found for ID: {}",
                params.id
            )));
        }
    };

    // Determine content type
    let content_type = if matches!(requested_size, ThumbnailSize::Small | ThumbnailSize::Medium) {
        // Thumbnails are always JPEG
        "image/jpeg"
    } else {
        // Detect original image type from magic bytes
        detect_image_content_type(&image_data)
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, image_data.len())
        .header(header::CACHE_CONTROL, COVER_ART_CACHE_HEADER)
        .body(Body::from(image_data))
        .unwrap())
}

/// Get album cover art, using pre-generated thumbnails for small/medium sizes
async fn get_album_cover_with_thumbnails(
    state: &AppState,
    album_id: &str,
    size: ThumbnailSize,
) -> Result<Vec<u8>> {
    // For small/medium, try thumbnail first
    if size != ThumbnailSize::Large {
        // Get hash from album
        let hash: Option<(String,)> =
            sqlx::query_as("SELECT cover_art_hash FROM albums WHERE id = ?")
                .bind(album_id)
                .fetch_optional(&state.pool)
                .await?;

        if let Some((hash,)) = hash {
            if let Ok(Some(thumbnail)) =
                crate::thumbnails::get_thumbnail(&state.pool, &hash, size).await
            {
                return Ok(thumbnail);
            }
        }
    }

    // Get original cover art
    get_album_cover_art_original(state, album_id).await
}

/// Get song cover art, preferring album thumbnails
async fn get_song_cover_with_thumbnails(
    state: &AppState,
    song_id: &str,
    size: ThumbnailSize,
) -> Result<Vec<u8>> {
    let song = crate::db::queries::get_song_by_id(&state.pool, song_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    // If song has a hash, use it
    if let Some(hash) = &song.cover_art_hash {
        if size != ThumbnailSize::Large {
            if let Ok(Some(thumbnail)) =
                crate::thumbnails::get_thumbnail(&state.pool, hash, size).await
            {
                return Ok(thumbnail);
            }
        }
    }

    // If song has an album, try to use album's cover
    if let Some(album_id) = &song.album_id {
        if let Ok(data) = get_album_cover_with_thumbnails(state, album_id, size).await {
            return Ok(data);
        }
    }

    // Fall back to song's own cover art
    get_song_cover_art_original(state, &song.id).await
}

/// Get artist cover art (from first album)
async fn get_artist_cover_with_thumbnails(
    state: &AppState,
    artist_id: &str,
    size: ThumbnailSize,
) -> Result<Vec<u8>> {
    let artist = crate::db::queries::get_artist_by_id(&state.pool, artist_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Artist {} not found", artist_id)))?;

    // Check artist's cover_art_hash
    if let Some(hash) = &artist.cover_art_hash {
        if size != ThumbnailSize::Large {
            if let Ok(Some(thumbnail)) =
                crate::thumbnails::get_thumbnail(&state.pool, hash, size).await
            {
                return Ok(thumbnail);
            }
        }
    }

    // Get first album by this artist
    let albums = crate::db::queries::get_albums_by_artist(&state.pool, artist_id).await?;

    if let Some(album) = albums.first() {
        return get_album_cover_with_thumbnails(state, &album.id, size).await;
    }

    // No albums - try to find a track by this artist
    let songs = crate::db::queries::get_songs_by_artist(&state.pool, artist_id).await?;

    if let Some(song) = songs.first() {
        if let Some(album_id) = &song.album_id {
            if let Ok(data) = get_album_cover_with_thumbnails(state, album_id, size).await {
                return Ok(data);
            }
        }
        // Fall back to song's own cover
        return get_song_cover_art_original(state, &song.id).await;
    }

    Err(Error::NotFound("No cover art found for artist".to_string()))
}

/// Get original album cover art from files (for large size or thumbnail fallback)
async fn get_album_cover_art_original(state: &AppState, album_id: &str) -> Result<Vec<u8>> {
    let _album = crate::db::queries::get_album_by_id(&state.pool, album_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Album {} not found", album_id)))?;

    // Get first song with its music folder path
    let song_with_folder: Option<(String, String)> = sqlx::query_as(
        "SELECT s.file_path, mf.path as folder_path
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.album_id = ?
         ORDER BY s.disc_number, s.track_number
         LIMIT 1",
    )
    .bind(album_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((file_path, folder_path)) = song_with_folder {
        let full_path = std::path::PathBuf::from(&folder_path).join(&file_path);

        // Try external cover art files first
        if let Ok(cover_data) = crate::thumbnails::find_external_cover_art(&full_path).await {
            return Ok(cover_data);
        }

        // Fall back to embedded cover art
        if let Ok(cover_data) = crate::thumbnails::extract_embedded_cover_art(&full_path).await {
            return Ok(cover_data);
        }
    }

    Err(Error::NotFound("No cover art found for album".to_string()))
}

/// Get song's own cover art from file
async fn get_song_cover_art_original(state: &AppState, song_id: &str) -> Result<Vec<u8>> {
    // Get the song's file path and music folder path
    let song_with_folder: Option<(String, String)> = sqlx::query_as(
        "SELECT s.file_path, mf.path as folder_path
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.id = ?",
    )
    .bind(song_id)
    .fetch_optional(&state.pool)
    .await?;

    let (file_path, folder_path) =
        song_with_folder.ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    let full_path = std::path::PathBuf::from(&folder_path).join(&file_path);

    // Try external cover art first
    if let Ok(cover_data) = crate::thumbnails::find_external_cover_art(&full_path).await {
        return Ok(cover_data);
    }

    // Fall back to embedded cover art
    crate::thumbnails::extract_embedded_cover_art(&full_path).await
}

/// Generate playlist cover art (2x2 tiled from album covers)
async fn get_playlist_cover_art(
    state: &AppState,
    playlist_id: &str,
    size: ThumbnailSize,
) -> Result<Vec<u8>> {
    // Get up to 4 hashes from playlist songs
    let hashes: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT s.cover_art_hash 
         FROM songs s
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         WHERE ps.playlist_id = ? AND s.cover_art_hash IS NOT NULL
         ORDER BY ps.position
         LIMIT 4",
    )
    .bind(playlist_id)
    .fetch_all(&state.pool)
    .await?;

    if hashes.is_empty() {
        return Err(Error::NotFound(
            "No cover art found for playlist".to_string(),
        ));
    }

    // For small/medium playlist covers, use small/medium album thumbnails
    let album_size = match size {
        ThumbnailSize::Small => ThumbnailSize::Small,
        ThumbnailSize::Medium => ThumbnailSize::Medium,
        ThumbnailSize::Large => ThumbnailSize::Medium, // Use medium for tiling efficiency
    };

    let mut covers: Vec<Vec<u8>> = Vec::new();
    for (hash,) in hashes {
        if let Ok(Some(cover_data)) =
            crate::thumbnails::get_thumbnail(&state.pool, &hash, album_size).await
        {
            covers.push(cover_data);
        }
    }

    if covers.is_empty() {
        return Err(Error::NotFound(
            "No cover art found for playlist".to_string(),
        ));
    }

    // If only one cover, return it directly (already at correct size)
    if covers.len() == 1 {
        return Ok(covers.remove(0));
    }

    // Target size based on requested size
    let target_size = match size {
        ThumbnailSize::Small => crate::thumbnails::THUMBNAIL_SMALL * 2, // 128px total
        ThumbnailSize::Medium => crate::thumbnails::THUMBNAIL_MEDIUM * 2, // 512px total
        ThumbnailSize::Large => state.config.cache.max_cover_size.min(600),
    };

    // Generate tiled image
    let tiled_image =
        tokio::task::spawn_blocking(move || generate_tiled_cover(covers, target_size))
            .await
            .map_err(|e| Error::Internal(e.to_string()))??;

    Ok(tiled_image)
}

/// Generate a 2x2 tiled image from cover art images
fn generate_tiled_cover(covers: Vec<Vec<u8>>, target_size: u32) -> Result<Vec<u8>> {
    use image::{DynamicImage, GenericImage, RgbImage};

    let tile_size = target_size / 2;

    let mut tiles: Vec<RgbImage> = Vec::new();
    for cover_data in &covers {
        if let Ok(img) = image::load_from_memory(cover_data) {
            let resized = img.resize_to_fill(tile_size, tile_size, FilterType::Triangle);
            tiles.push(resized.to_rgb8());
        }
    }

    if tiles.is_empty() {
        return Err(Error::NotFound(
            "Failed to process cover images".to_string(),
        ));
    }

    let mut output = RgbImage::new(target_size, target_size);

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
        .map_err(Error::Image)?;

    Ok(buffer.into_inner())
}

/// Detect image content type from magic bytes
fn detect_image_content_type(data: &[u8]) -> &'static str {
    if data.len() < 4 {
        return "application/octet-stream";
    }

    // Check magic bytes
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if data.starts_with(b"GIF8") {
        "image/gif"
    } else if data.starts_with(b"RIFF") && data.len() > 11 && &data[8..12] == b"WEBP" {
        "image/webp"
    } else if data.len() > 11
        && (&data[4..8] == b"ftyp" || &data[4..12] == b"ftypavif" || &data[4..12] == b"ftypavis")
    {
        "image/avif"
    } else {
        // Default to JPEG as it's most common for cover art
        "image/jpeg"
    }
}
