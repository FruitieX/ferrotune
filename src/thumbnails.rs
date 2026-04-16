//! Album cover art thumbnail generation
//!
//! Generates pre-sized thumbnails for album cover art at standard sizes:
//! - Small: For list items, rows (high-DPI optimized)
//! - Medium: For cards, dialogs
//!
//! Thumbnails are stored as JPEG for broad compatibility.
//! Original/large images are served directly from the media files.
//!
//! # Architecture
//!
//! Thumbnails are deduplicated using a BLAKE3 hash of the original image content.
//! This allows:
//! - Multiple albums/songs to share the same cover art without storage overhead
//! - Identical duplicate tracks to share cover art
//! - Efficient caching based on content hash

use crate::db::DatabaseHandle;
use crate::error::{Error, Result};
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use lofty::config::ParseOptions;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use std::io::Cursor;
use std::path::Path;
use tokio::fs;

/// Size constants for thumbnails
pub const THUMBNAIL_SMALL: u32 = 80;
pub const THUMBNAIL_MEDIUM: u32 = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailSize {
    Small,
    Medium,
    Large,
}

impl ThumbnailSize {
    pub fn from_size(s: u32) -> Self {
        if s <= THUMBNAIL_SMALL {
            ThumbnailSize::Small
        } else if s <= THUMBNAIL_MEDIUM {
            ThumbnailSize::Medium
        } else {
            ThumbnailSize::Large
        }
    }
}

impl std::str::FromStr for ThumbnailSize {
    type Err = ();

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "small" | "s" => Ok(ThumbnailSize::Small),
            "medium" | "m" => Ok(ThumbnailSize::Medium),
            "large" | "l" | "original" => Ok(ThumbnailSize::Large),
            _ => Err(()),
        }
    }
}

/// Result of processing cover art, including hash and dimensions
#[derive(Debug, Clone)]
pub struct CoverArtResult {
    /// BLAKE3 hash of the original image content
    pub hash: String,
    /// Width of the original image in pixels
    pub width: u32,
    /// Height of the original image in pixels
    pub height: u32,
}

/// Ensure cover art thumbnails exist for the given image data.
///
/// Returns the BLAKE3 hash and dimensions of the image content.
/// If the hash already exists in `cover_art_thumbnails`, dimensions are still computed.
/// Otherwise, thumbnails are generated and inserted.
pub async fn ensure_cover_art_with_dimensions(
    database: &(impl DatabaseHandle + ?Sized),
    image_data: &[u8],
) -> Result<CoverArtResult> {
    let pool = database.sqlite_pool()?;

    // 1. Compute hash
    let hash = blake3::hash(image_data).to_hex().to_string();

    // 2. Check if exists
    let exists = sqlx::query_scalar::<_, i64>("SELECT 1 FROM cover_art_thumbnails WHERE hash = ?")
        .bind(&hash)
        .fetch_optional(pool)
        .await?
        .is_some();

    // Clone data for the blocking task
    let data = image_data.to_vec();

    if exists {
        // Still need to get dimensions even if thumbnails exist
        let (width, height) = tokio::task::spawn_blocking(move || get_image_dimensions(&data))
            .await
            .map_err(|e| Error::Internal(e.to_string()))??;

        return Ok(CoverArtResult {
            hash,
            width,
            height,
        });
    }

    // 3. Generate thumbnails and get dimensions
    let (small, medium, width, height) =
        tokio::task::spawn_blocking(move || generate_thumbnail_pair_with_dimensions(&data))
            .await
            .map_err(|e| Error::Internal(e.to_string()))??;

    // 4. Insert
    sqlx::query(
        r#"
        INSERT INTO cover_art_thumbnails (hash, small, medium, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(hash) DO NOTHING
        "#,
    )
    .bind(&hash)
    .bind(small)
    .bind(medium)
    .execute(pool)
    .await?;

    Ok(CoverArtResult {
        hash,
        width,
        height,
    })
}

/// Generate both thumbnail sizes from cover art data and return dimensions
fn generate_thumbnail_pair_with_dimensions(data: &[u8]) -> Result<(Vec<u8>, Vec<u8>, u32, u32)> {
    let img = image::load_from_memory(data).map_err(Error::Image)?;

    let width = img.width();
    let height = img.height();

    let small = resize_and_encode(&img, THUMBNAIL_SMALL)?;
    let medium = resize_and_encode(&img, THUMBNAIL_MEDIUM)?;

    Ok((small, medium, width, height))
}

/// Get image dimensions without generating thumbnails
fn get_image_dimensions(data: &[u8]) -> Result<(u32, u32)> {
    let img = image::load_from_memory(data).map_err(Error::Image)?;
    Ok((img.width(), img.height()))
}

/// Get a thumbnail by hash and size
pub async fn get_thumbnail(
    database: &(impl DatabaseHandle + ?Sized),
    hash: &str,
    size: ThumbnailSize,
) -> Result<Option<Vec<u8>>> {
    let pool = database.sqlite_pool()?;

    let column = match size {
        ThumbnailSize::Small => "small",
        ThumbnailSize::Medium => "medium",
        ThumbnailSize::Large => return Ok(None),
    };

    let query = format!("SELECT {} FROM cover_art_thumbnails WHERE hash = ?", column);
    let result: Option<(Vec<u8>,)> = sqlx::query_as(&query)
        .bind(hash)
        .fetch_optional(pool)
        .await?;

    Ok(result.map(|(data,)| data))
}

/// Resize image to target size (square crop) and encode as JPEG
fn resize_and_encode(img: &DynamicImage, size: u32) -> Result<Vec<u8>> {
    // Use resize_to_fill for square output with crop
    let resized = img.resize_to_fill(size, size, FilterType::Triangle);

    let mut buffer = Cursor::new(Vec::new());
    resized
        .write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(Error::Image)?;

    Ok(buffer.into_inner())
}

// Re-export utility functions needed by scanner
pub async fn find_external_cover_art(path: &Path) -> Result<Vec<u8>> {
    let dir = path
        .parent()
        .ok_or_else(|| Error::NotFound("No parent directory".to_string()))?;

    let cover_names = [
        "folder.jpg",
        "folder.png",
        "cover.jpg",
        "cover.png",
        "front.jpg",
        "front.png",
        "album.jpg",
        "album.png",
        "albumart.jpg",
        "albumart.png",
        "Folder.jpg",
        "Cover.jpg",
        "Front.jpg",
    ];

    for name in &cover_names {
        let cover_path = dir.join(name);
        if cover_path.exists() {
            let data = fs::read(&cover_path).await?;
            return Ok(data);
        }
    }

    Err(Error::NotFound("No external cover art found".to_string()))
}

pub async fn extract_embedded_cover_art(path: &Path) -> Result<Vec<u8>> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let parse_options = ParseOptions::new().read_properties(false);

        let tagged_file = Probe::open(&path)
            .map_err(Error::Lofty)?
            .options(parse_options)
            .read()
            .map_err(Error::Lofty)?;

        let picture = tagged_file
            .primary_tag()
            .and_then(|tag| tag.pictures().first())
            .or_else(|| {
                tagged_file
                    .tags()
                    .iter()
                    .find_map(|tag| tag.pictures().first())
            })
            .ok_or_else(|| Error::NotFound("No embedded cover art".to_string()))?;

        Ok(picture.data().to_vec())
    })
    .await
    .map_err(|e| Error::Internal(e.to_string()))?
}
