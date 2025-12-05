use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::api::ferrotune::users::user_has_song_access;
use crate::error::{Error, Result};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
pub struct StreamParams {
    id: String,
    #[serde(rename = "maxBitRate")]
    max_bit_rate: Option<u32>,
    format: Option<String>,
    #[serde(rename = "timeOffset")]
    time_offset: Option<u32>,
}

pub async fn stream(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<StreamParams>,
) -> Result<Response> {
    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", params.id)))?;

    // Check if user has access to this song's library
    if !user_has_song_access(&state.pool, user.user_id, &params.id).await? {
        return Err(Error::Forbidden(format!(
            "You do not have access to song {}",
            params.id
        )));
    }

    // Find the music folder for this song
    let music_folders = crate::db::queries::get_music_folders(&state.pool).await?;
    
    let mut full_path: Option<PathBuf> = None;
    for folder in music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path = full_path
        .ok_or_else(|| Error::NotFound(format!("File not found: {}", song.file_path)))?;

    // Security: Ensure the resolved path is still within a music folder
    let canonical_path = full_path
        .canonicalize()
        .map_err(|_| Error::NotFound("File not found".to_string()))?;

    let mut is_within_folder = false;
    for folder in &state.config.music.folders {
        if let Ok(canonical_folder) = folder.path.canonicalize() {
            if canonical_path.starts_with(&canonical_folder) {
                is_within_folder = true;
                break;
            }
        }
    }

    if !is_within_folder {
        tracing::warn!(
            "Attempted path traversal: requested {}, resolved to {}",
            song.file_path,
            canonical_path.display()
        );
        return Err(Error::NotFound("File not found".to_string()));
    }

    // Check if transcoding is requested (not implemented yet)
    if params.max_bit_rate.is_some() || params.format.is_some() {
        tracing::debug!(
            "Transcoding requested but not implemented, serving original file"
        );
    }

    // Open file
    let mut file = File::open(&canonical_path).await?;
    let file_size = file.metadata().await?.len();

    // Determine content type
    let content_type = match song.file_format.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    // Handle range requests (for seeking)
    if let Some(range_header) = headers.get(header::RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(range) = parse_range(range_str, file_size) {
                return serve_range(file, range, file_size, content_type).await;
            }
        }
    }

    // Serve entire file
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, file_size)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap())
}

#[derive(Debug)]
struct Range {
    start: u64,
    end: u64,
}

fn parse_range(range_header: &str, file_size: u64) -> Option<Range> {
    // Parse "bytes=start-end" format
    let range_str = range_header.strip_prefix("bytes=")?;
    
    let parts: Vec<&str> = range_str.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start = if parts[0].is_empty() {
        // Suffix range (e.g., "-500" means last 500 bytes)
        let suffix_len: u64 = parts[1].parse().ok()?;
        file_size.saturating_sub(suffix_len)
    } else {
        parts[0].parse().ok()?
    };

    let end = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse::<u64>().ok()?.min(file_size - 1)
    };

    if start > end || start >= file_size {
        return None;
    }

    Some(Range { start, end })
}

async fn serve_range(
    mut file: File,
    range: Range,
    file_size: u64,
    content_type: &str,
) -> Result<Response> {
    // Seek to start position
    file.seek(std::io::SeekFrom::Start(range.start)).await?;

    // Create a limited reader for the range
    let length = range.end - range.start + 1;
    let limited = file.take(length);
    let stream = ReaderStream::new(limited);
    let body = Body::from_stream(stream);

    let content_range = format!("bytes {}-{}/{}", range.start, range.end, file_size);

    Ok(Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, length)
        .header(header::CONTENT_RANGE, content_range)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap())
}

// Download endpoint (same as stream but with attachment disposition)
pub async fn download(
    user: AuthenticatedUser,
    state: State<Arc<AppState>>,
    headers: HeaderMap,
    params: Query<StreamParams>,
) -> Result<Response> {
    let mut response = stream(user, state, headers, params).await?;
    
    // Add Content-Disposition header for download
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        "attachment".parse().unwrap(),
    );

    Ok(response)
}
