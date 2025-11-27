use crate::api::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, Result};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::Response,
};
use image::{imageops::FilterType, ImageFormat};
use lofty::config::ParseOptions;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use serde::Deserialize;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;

#[derive(Deserialize)]
pub struct CoverArtParams {
    id: String,
    size: Option<u32>,
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
    
    // The ID can be for a song, album, or artist
    // Try to find cover art in this order: song -> album -> artist
    
    let cover_art_data = if params.id.starts_with("so-") {
        // Song ID
        get_song_cover_art(&state, &params.id).await?
    } else if params.id.starts_with("al-") {
        // Album ID
        get_album_cover_art(&state, &params.id).await?
    } else if params.id.starts_with("ar-") {
        // Artist ID
        get_artist_cover_art(&state, &params.id).await?
    } else {
        return Err(Error::InvalidRequest(format!("Invalid cover art ID: {}", params.id)));
    };

    // Process image (resize if requested) in blocking task
    let max_size = params.size.map(|s| s.min(state.config.cache.max_cover_size));
    let image_data = process_image(cover_art_data, max_size).await?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CONTENT_LENGTH, image_data.len())
        .header(header::CACHE_CONTROL, "public, max-age=2592000") // 30 days
        .body(Body::from(image_data))
        .unwrap())
}

async fn process_image(data: Vec<u8>, max_size: Option<u32>) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        let img = image::load_from_memory(&data)
            .map_err(|e| Error::Image(e))?;

        let (width, height) = (img.width(), img.height());

        // Check if resize is needed
        let needs_resize = max_size.map(|s| width > s || height > s).unwrap_or(false);

        if !needs_resize {
            // Return original data if it's already JPEG, otherwise re-encode
            // Check for JPEG magic bytes
            if data.len() > 2 && data[0] == 0xFF && data[1] == 0xD8 {
                return Ok(data);
            }
            let mut buffer = Cursor::new(Vec::new());
            img.write_to(&mut buffer, ImageFormat::Jpeg)
                .map_err(|e| Error::Image(e))?;
            return Ok(buffer.into_inner());
        }

        let max_size = max_size.unwrap();

        // Calculate new dimensions maintaining aspect ratio
        let (new_width, new_height) = if width > height {
            let ratio = max_size as f32 / width as f32;
            (max_size, (height as f32 * ratio) as u32)
        } else {
            let ratio = max_size as f32 / height as f32;
            ((width as f32 * ratio) as u32, max_size)
        };

        // Use faster Triangle filter instead of Lanczos3
        let resized = img.resize(new_width, new_height, FilterType::Triangle);

        let mut buffer = Cursor::new(Vec::new());
        resized
            .write_to(&mut buffer, ImageFormat::Jpeg)
            .map_err(|e| Error::Image(e))?;

        Ok(buffer.into_inner())
    })
    .await
    .map_err(|e| Error::Internal(e.to_string()))?
}

async fn get_song_cover_art(state: &AppState, song_id: &str) -> Result<Vec<u8>> {
    let song = crate::db::queries::get_song_by_id(&state.pool, song_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    // Try embedded cover art first
    if let Ok(cover_data) = extract_embedded_cover_art(state, &song.file_path).await {
        return Ok(cover_data);
    }

    // Try album cover art
    if let Some(album_id) = song.album_id {
        if let Ok(cover_data) = get_album_cover_art(state, &album_id).await {
            return Ok(cover_data);
        }
    }

    // Fallback to placeholder
    Err(Error::NotFound("No cover art found".to_string()))
}

async fn get_album_cover_art(state: &AppState, album_id: &str) -> Result<Vec<u8>> {
    let _album = crate::db::queries::get_album_by_id(&state.pool, album_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Album {} not found", album_id)))?;

    // Get a song from this album to extract cover art
    let songs = crate::db::queries::get_songs_by_album(&state.pool, album_id).await?;
    
    if let Some(song) = songs.first() {
        // Try embedded cover art
        if let Ok(cover_data) = extract_embedded_cover_art(state, &song.file_path).await {
            return Ok(cover_data);
        }

        // Try external cover art files (folder.jpg, cover.jpg, etc.)
        if let Ok(cover_data) = find_external_cover_art(state, &song.file_path).await {
            return Ok(cover_data);
        }
    }

    Err(Error::NotFound("No cover art found for album".to_string()))
}

async fn get_artist_cover_art(state: &AppState, artist_id: &str) -> Result<Vec<u8>> {
    let _artist = crate::db::queries::get_artist_by_id(&state.pool, artist_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Artist {} not found", artist_id)))?;

    // Get first album by this artist
    let albums = crate::db::queries::get_albums_by_artist(&state.pool, artist_id).await?;
    
    if let Some(album) = albums.first() {
        return get_album_cover_art(state, &album.id).await;
    }

    Err(Error::NotFound("No cover art found for artist".to_string()))
}

async fn extract_embedded_cover_art(state: &AppState, file_path: &str) -> Result<Vec<u8>> {
    // Find the full path
    let mut full_path: Option<PathBuf> = None;
    for folder in &state.config.music.folders {
        let candidate = folder.path.join(file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path = full_path
        .ok_or_else(|| Error::NotFound(format!("File not found: {}", file_path)))?;

    // Run blocking lofty operations in spawn_blocking
    tokio::task::spawn_blocking(move || {
        // Skip reading audio properties - we only need cover art
        let parse_options = ParseOptions::new().read_properties(false);
        
        let tagged_file = Probe::open(&full_path)
            .map_err(Error::Lofty)?
            .options(parse_options)
            .read()
            .map_err(Error::Lofty)?;

        // Try to get picture from primary tag or any tag
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

async fn find_external_cover_art(state: &AppState, file_path: &str) -> Result<Vec<u8>> {
    // Find the full path
    let mut full_path: Option<PathBuf> = None;
    for folder in &state.config.music.folders {
        let candidate = folder.path.join(file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path = full_path
        .ok_or_else(|| Error::NotFound(format!("File not found: {}", file_path)))?;

    // Get the directory containing the music file
    let dir = full_path
        .parent()
        .ok_or_else(|| Error::NotFound("No parent directory".to_string()))?;

    // Common cover art filenames
    let cover_names = [
        "folder.jpg", "folder.png",
        "cover.jpg", "cover.png",
        "front.jpg", "front.png",
        "album.jpg", "album.png",
        "albumart.jpg", "albumart.png",
        "Folder.jpg", "Cover.jpg", "Front.jpg",
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


