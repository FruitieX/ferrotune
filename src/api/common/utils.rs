//! Common utility functions for the API
//!
//! This module provides reusable utility functions that are used across
//! both the OpenSubsonic and Ferrotune APIs.

use crate::thumbnails::ThumbnailSize;
use chrono::{DateTime, Utc};

/// Format a DateTime in ISO 8601 format without milliseconds
/// Example: "2024-01-15T12:30:45Z"
pub fn format_datetime_iso(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Format a DateTime in ISO 8601 format with milliseconds
/// Example: "2024-01-15T12:30:45.123Z"
pub fn format_datetime_iso_ms(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Format an optional DateTime in ISO 8601 format without milliseconds
#[allow(dead_code)]
pub fn format_datetime_iso_opt(dt: Option<DateTime<Utc>>) -> Option<String> {
    dt.map(format_datetime_iso)
}

/// Format an optional DateTime in ISO 8601 format with milliseconds
#[allow(dead_code)]
pub fn format_datetime_iso_ms_opt(dt: Option<DateTime<Utc>>) -> Option<String> {
    dt.map(format_datetime_iso_ms)
}

/// Get the MIME content type for a given audio file format
pub fn get_content_type_for_format(format: &str) -> &'static str {
    match format {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "wma" => "audio/x-ms-wma",
        _ => "application/octet-stream",
    }
}

/// Parse inline images parameter string to ThumbnailSize
/// Accepts: "small", "s", "medium", "m"
pub fn parse_inline_images(value: Option<&str>) -> Option<ThumbnailSize> {
    match value {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    }
}
