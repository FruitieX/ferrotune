use crate::api::common::utils::get_content_type_for_format;
use crate::api::ferrotune::users::user_has_song_access;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::transcoding::{transcode_with_offset, ReplayGainInfo, TranscodeConfig};
use crate::api::AppState;
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
    /// Seek mode: "accurate" for sample-accurate seeking (slower), "coarse" for fast seeking
    #[serde(rename = "seekMode")]
    seek_mode: Option<String>,
}

pub async fn stream(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<StreamParams>,
) -> Result<Response> {
    // Get song from database
    let song = crate::db::repo::browse::get_song_by_id(&state.database, &params.id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", params.id)))?;

    // Check if user has access to this song's library
    if !user_has_song_access(&state.database, user.user_id, &params.id).await? {
        return Err(Error::Forbidden(format!(
            "You do not have access to song {}",
            params.id
        )));
    }

    // Find the music folder for this song
    let music_folders = crate::db::repo::users::get_music_folders(&state.database).await?;

    let mut full_path: Option<PathBuf> = None;
    for folder in &music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path =
        full_path.ok_or_else(|| Error::NotFound(format!("File not found: {}", song.file_path)))?;

    // Security: Ensure the resolved path is still within a music folder (from database)
    let canonical_path = full_path
        .canonicalize()
        .map_err(|_| Error::NotFound("File not found".to_string()))?;

    let mut is_within_folder = false;
    for folder in &music_folders {
        if let Ok(canonical_folder) = PathBuf::from(&folder.path).canonicalize() {
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

    // Check if transcoding is requested (format conversion or bitrate limit or time offset)
    let needs_transcoding =
        params.format.is_some() || params.max_bit_rate.is_some() || params.time_offset.is_some();

    if needs_transcoding {
        // Determine target format and bitrate
        let target_format = params.format.as_deref().unwrap_or("opus");
        let target_bitrate = params.max_bit_rate.unwrap_or(128) * 1000; // Convert kbps to bps
        let time_offset_seconds = params.time_offset.unwrap_or(0) as f64;

        // For now we only support Opus transcoding
        if target_format != "opus" && target_format != "ogg" {
            tracing::debug!(
                "Requested format {} not supported for transcoding, serving original",
                target_format
            );
            // Fall through to serve original file
        } else {
            // Use transcoding with offset
            let config = TranscodeConfig {
                song_id: params.id.clone(),
                bitrate: target_bitrate,
                sample_rate: 48000,
                channels: 2, // Default stereo
            };

            // Build ReplayGain info from song data
            let replaygain_info = ReplayGainInfo {
                track_gain: song
                    .computed_replaygain_track_gain
                    .or(song.original_replaygain_track_gain),
                track_peak: song
                    .computed_replaygain_track_peak
                    .or(song.original_replaygain_track_peak),
            };

            return transcode_with_offset(
                &canonical_path,
                &config,
                time_offset_seconds,
                replaygain_info,
                params.seek_mode.as_deref().unwrap_or("coarse") == "accurate",
            )
            .await;
        }
    }

    // Open file (no transcoding needed)
    let file = File::open(&canonical_path).await?;
    let file_size = file.metadata().await?.len();

    // Determine content type
    let content_type = get_content_type_for_format(&song.file_format);

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
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, "attachment".parse().unwrap());

    Ok(response)
}
