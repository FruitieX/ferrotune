//! Tag management endpoints for the Admin API.
//!
//! Provides endpoints to read and write audio file tags/metadata.
//! Writing tags requires `readonly_tags = false` in config.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::tag_io;
use crate::api::AppState;
use crate::db::repo;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use ts_rs::TS;

use super::server_config::is_tag_editing_enabled;
use super::ErrorResponse;

pub use tag_io::CoverArtAction;

/// A single tag entry with key-value pair.
///
/// Standard fields use canonical names in every format ("TITLE", "ALBUMARTIST",
/// "TRACKNUMBER", "REPLAYGAIN_TRACK_GAIN", ...). Other keys are format-native:
/// Vorbis field names ("URL", "SPOTIFY_ID"), ID3v2 TXXX descriptions or
/// prefixed frames ("Source", "TXXX:YEAR", "WXXX:", "COMM:iTunNORM", "PRIV:owner"),
/// MP4 atoms ("©url", "----:com.apple.iTunes:UPC" or just "UPC"). A key that
/// appears several times holds several values.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TagEntry {
    /// The tag key (e.g., "TITLE", "ARTIST", "REPLAYGAIN_TRACK_GAIN")
    pub key: String,
    /// The tag value as a string
    pub value: String,
    /// The key as stored in the file, when it differs from `key`
    /// (e.g. "TIT2" for "TITLE", "ALBUM ARTIST" for "ALBUMARTIST")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub native_key: Option<String>,
    /// Binary or structured items (e.g. ID3v2 PRIV/UFID frames) that are
    /// listed but cannot be edited
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
}

impl TagEntry {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            value: value.into(),
            native_key: None,
            read_only: false,
        }
    }
}

/// Response for GET /api/songs/:id/tags
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetTagsResponse {
    /// The song ID
    pub id: String,
    /// File path relative to music folder
    pub file_path: String,
    /// File format (mp3, flac, etc.)
    pub file_format: String,
    /// Whether tag editing is enabled in config
    pub editing_enabled: bool,
    /// The type of primary tag (ID3v2, Vorbis, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_type: Option<String>,
    /// All tags from the primary tag block
    pub tags: Vec<TagEntry>,
    /// Additional tag blocks (e.g., ID3v1 alongside ID3v2)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub additional_tags: Vec<AdditionalTagBlock>,
}

/// A secondary tag block
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AdditionalTagBlock {
    /// Tag type name
    pub tag_type: String,
    /// Tags in this block
    pub tags: Vec<TagEntry>,
}

/// Request for PATCH /api/songs/:id/tags
#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateTagsRequest {
    /// Tags to set. All values of a key are replaced by the entries given for
    /// it (repeat a key to write several values); an empty value deletes the
    /// key. Keys that are not named keep their values.
    #[serde(default)]
    pub set: Vec<TagEntry>,
    /// Tag keys to delete
    #[serde(default)]
    pub delete: Vec<String>,
}

/// Response for PATCH /api/songs/:id/tags
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateTagsResponse {
    pub success: bool,
    pub message: String,
    /// Tags that were changed (old and new values)
    pub changes: Vec<TagChange>,
    /// Whether a library rescan is recommended (for artist/album changes)
    pub rescan_recommended: bool,
}

/// A single tag change
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TagChange {
    pub key: String,
    pub action: String, // "set", "deleted"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_value: Option<String>,
}

/// Get the full file path for a song
async fn get_song_file_path(
    database: &crate::db::Database,
    song_id: &str,
) -> Result<(crate::db::models::Song, PathBuf), (StatusCode, Json<ErrorResponse>)> {
    // Get song from database
    let song = match repo::browse::get_song_by_id(database, song_id).await {
        Ok(Some(song)) => song,
        Ok(None) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("Song not found: {}", song_id))),
            ));
        }
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details("Database error", e.to_string())),
            ));
        }
    };

    // Get all music folders and find where the file exists
    let music_folders = repo::users::get_music_folders(database)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details("Database error", e.to_string())),
            )
        })?;

    let mut full_path: Option<PathBuf> = None;
    for folder in music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path = full_path.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!(
                "File not found on disk: {}",
                song.file_path
            ))),
        )
    })?;

    Ok((song, full_path))
}

/// GET /api/songs/:id/tags
///
/// Get all tags from a song file. Works even when editing is disabled (read-only mode).
pub async fn get_tags(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let (song, full_path) = match get_song_file_path(&state.database, &id).await {
        Ok(result) => result,
        Err(e) => return e.into_response(),
    };

    let result = tokio::task::spawn_blocking(move || tag_io::read_tags(&full_path)).await;

    match result {
        Ok(Ok(listing)) => Json(GetTagsResponse {
            id: song.id,
            file_path: song.file_path,
            file_format: song.file_format,
            editing_enabled: is_tag_editing_enabled(&state).await,
            tag_type: listing.tag_type,
            tags: listing.tags,
            additional_tags: listing.additional,
        })
        .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(e)),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details("Task failed", e.to_string())),
        )
            .into_response(),
    }
}

/// Keys whose changes affect how the library is organized.
const RESCAN_KEYS: [&str; 8] = [
    "ARTIST",
    "ALBUM",
    "ALBUMARTIST",
    "TITLE",
    "TRACKNUMBER",
    "DISCNUMBER",
    "YEAR",
    "GENRE",
];

/// Whether a tag update touches keys that need a library rescan.
pub fn needs_rescan(request: &UpdateTagsRequest) -> bool {
    request
        .set
        .iter()
        .map(|t| t.key.as_str())
        .chain(request.delete.iter().map(String::as_str))
        .any(|k| RESCAN_KEYS.contains(&k.to_uppercase().as_str()))
}

/// PATCH /api/songs/:id/tags
///
/// Update tags in a song file. Requires `readonly_tags = false` in config.
pub async fn update_tags(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateTagsRequest>,
) -> impl IntoResponse {
    // Check if editing is enabled
    if !is_tag_editing_enabled(&state).await {
        return (
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::with_details(
                "Tag editing is disabled",
                "Enable tag editing in server configuration",
            )),
        )
            .into_response();
    }

    // Validate request
    if request.set.is_empty() && request.delete.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("No changes specified")),
        )
            .into_response();
    }

    let (_song, full_path) = match get_song_file_path(&state.database, &id).await {
        Ok(result) => result,
        Err(e) => return e.into_response(),
    };

    let rescan_recommended = needs_rescan(&request);

    match update_tags_with_cover_art(&full_path, &request, CoverArtAction::Keep).await {
        Ok(changes) if changes.is_empty() => Json(UpdateTagsResponse {
            success: true,
            message: "No changes were needed".to_string(),
            changes: vec![],
            rescan_recommended: false,
        })
        .into_response(),
        Ok(changes) => {
            let change_count = changes.len();
            Json(UpdateTagsResponse {
                success: true,
                message: format!(
                    "Successfully updated {} tag{}",
                    change_count,
                    if change_count == 1 { "" } else { "s" }
                ),
                changes,
                rescan_recommended,
            })
            .into_response()
        }
        Err(tag_io::TagIoError::InvalidRequest(e)) => {
            (StatusCode::BAD_REQUEST, Json(ErrorResponse::new(e))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(e.to_string())),
        )
            .into_response(),
    }
}

/// Update tags (and optionally cover art) of a file. Keys that the request
/// does not name are preserved, including non-standard and binary ones.
pub async fn update_tags_with_cover_art(
    full_path: &std::path::Path,
    request: &UpdateTagsRequest,
    cover_art: CoverArtAction,
) -> Result<Vec<TagChange>, tag_io::TagIoError> {
    let set_tags = request.set.clone();
    let delete_tags = request.delete.clone();
    let path = full_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        tag_io::update_tags(&path, &set_tags, &delete_tags, cover_art)
    })
    .await
    .map_err(|e| tag_io::TagIoError::Failed(format!("Task failed: {}", e)))?
}
