//! Tag management endpoints for the Admin API.
//!
//! Provides endpoints to read and write audio file tags/metadata.
//! Writing tags requires `readonly_tags = false` in config.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::queries;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagItem, TagType};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

use super::ErrorResponse;

/// A single tag entry with key-value pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagEntry {
    /// The tag key (e.g., "TITLE", "ARTIST", "REPLAYGAIN_TRACK_GAIN")
    pub key: String,
    /// The tag value as a string
    pub value: String,
}

/// Response for GET /api/songs/:id/tags
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdditionalTagBlock {
    /// Tag type name
    pub tag_type: String,
    /// Tags in this block
    pub tags: Vec<TagEntry>,
}

/// Request for PATCH /api/songs/:id/tags
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagsRequest {
    /// Tags to set (will overwrite existing values for these keys)
    #[serde(default)]
    pub set: Vec<TagEntry>,
    /// Tag keys to delete
    #[serde(default)]
    pub delete: Vec<String>,
}

/// Response for PATCH /api/songs/:id/tags
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagsResponse {
    pub success: bool,
    pub message: String,
    /// Tags that were changed (old and new values)
    pub changes: Vec<TagChange>,
    /// Whether a library rescan is recommended (for artist/album changes)
    pub rescan_recommended: bool,
}

/// A single tag change
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagChange {
    pub key: String,
    pub action: String, // "set", "deleted"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_value: Option<String>,
}

/// Map ItemKey to a human-readable string and vice versa
fn item_key_to_string(key: &ItemKey) -> String {
    match key {
        ItemKey::TrackTitle => "TITLE".to_string(),
        ItemKey::TrackArtist => "ARTIST".to_string(),
        ItemKey::AlbumTitle => "ALBUM".to_string(),
        ItemKey::AlbumArtist => "ALBUMARTIST".to_string(),
        ItemKey::TrackNumber => "TRACKNUMBER".to_string(),
        ItemKey::TrackTotal => "TRACKTOTAL".to_string(),
        ItemKey::DiscNumber => "DISCNUMBER".to_string(),
        ItemKey::DiscTotal => "DISCTOTAL".to_string(),
        ItemKey::Year => "YEAR".to_string(),
        ItemKey::RecordingDate => "DATE".to_string(),
        ItemKey::Genre => "GENRE".to_string(),
        ItemKey::Comment => "COMMENT".to_string(),
        ItemKey::Composer => "COMPOSER".to_string(),
        ItemKey::Conductor => "CONDUCTOR".to_string(),
        ItemKey::Lyricist => "LYRICIST".to_string(),
        ItemKey::Publisher => "PUBLISHER".to_string(),
        ItemKey::Label => "LABEL".to_string(),
        ItemKey::CatalogNumber => "CATALOGNUMBER".to_string(),
        ItemKey::Barcode => "BARCODE".to_string(),
        ItemKey::Isrc => "ISRC".to_string(),
        ItemKey::ReplayGainTrackGain => "REPLAYGAIN_TRACK_GAIN".to_string(),
        ItemKey::ReplayGainTrackPeak => "REPLAYGAIN_TRACK_PEAK".to_string(),
        ItemKey::ReplayGainAlbumGain => "REPLAYGAIN_ALBUM_GAIN".to_string(),
        ItemKey::ReplayGainAlbumPeak => "REPLAYGAIN_ALBUM_PEAK".to_string(),
        ItemKey::MusicBrainzRecordingId => "MUSICBRAINZ_TRACKID".to_string(),
        ItemKey::MusicBrainzTrackId => "MUSICBRAINZ_RELEASETRACKID".to_string(),
        ItemKey::MusicBrainzReleaseId => "MUSICBRAINZ_ALBUMID".to_string(),
        ItemKey::MusicBrainzReleaseGroupId => "MUSICBRAINZ_RELEASEGROUPID".to_string(),
        ItemKey::MusicBrainzArtistId => "MUSICBRAINZ_ARTISTID".to_string(),
        ItemKey::MusicBrainzReleaseArtistId => "MUSICBRAINZ_ALBUMARTISTID".to_string(),
        ItemKey::MusicBrainzWorkId => "MUSICBRAINZ_WORKID".to_string(),
        ItemKey::Bpm => "BPM".to_string(),
        ItemKey::InitialKey => "KEY".to_string(),
        ItemKey::Mood => "MOOD".to_string(),
        ItemKey::Lyrics => "LYRICS".to_string(),
        ItemKey::EncoderSoftware => "ENCODER".to_string(),
        ItemKey::EncoderSettings => "ENCODERSETTINGS".to_string(),
        ItemKey::CopyrightMessage => "COPYRIGHT".to_string(),
        ItemKey::License => "LICENSE".to_string(),
        ItemKey::Remixer => "REMIXER".to_string(),
        ItemKey::MixDj => "DJMIXER".to_string(),
        ItemKey::MixEngineer => "MIXER".to_string(),
        ItemKey::Producer => "PRODUCER".to_string(),
        ItemKey::Engineer => "ENGINEER".to_string(),
        ItemKey::Performer => "PERFORMER".to_string(),
        ItemKey::Arranger => "ARRANGER".to_string(),
        ItemKey::Writer => "WRITER".to_string(),
        ItemKey::Director => "DIRECTOR".to_string(),
        ItemKey::Work => "WORK".to_string(),
        ItemKey::Movement => "MOVEMENT".to_string(),
        ItemKey::MovementNumber => "MOVEMENTNUMBER".to_string(),
        ItemKey::MovementTotal => "MOVEMENTTOTAL".to_string(),
        ItemKey::ShowName => "SHOWNAME".to_string(),
        ItemKey::Language => "LANGUAGE".to_string(),
        ItemKey::Script => "SCRIPT".to_string(),
        ItemKey::Description => "DESCRIPTION".to_string(),
        ItemKey::OriginalAlbumTitle => "ORIGINALALBUM".to_string(),
        ItemKey::OriginalArtist => "ORIGINALARTIST".to_string(),
        ItemKey::OriginalLyricist => "ORIGINALLYRICIST".to_string(),
        ItemKey::OriginalReleaseDate => "ORIGINALDATE".to_string(),
        ItemKey::FlagCompilation => "COMPILATION".to_string(),
        ItemKey::Unknown(s) => s.clone(),
        // For any other keys, use debug format
        other => format!("{:?}", other),
    }
}

/// Convert a string key back to ItemKey
fn string_to_item_key(key: &str) -> ItemKey {
    match key.to_uppercase().as_str() {
        "TITLE" => ItemKey::TrackTitle,
        "ARTIST" => ItemKey::TrackArtist,
        "ALBUM" => ItemKey::AlbumTitle,
        "ALBUMARTIST" | "ALBUM ARTIST" => ItemKey::AlbumArtist,
        "TRACKNUMBER" | "TRACK" => ItemKey::TrackNumber,
        "TRACKTOTAL" | "TOTALTRACKS" => ItemKey::TrackTotal,
        "DISCNUMBER" | "DISC" => ItemKey::DiscNumber,
        "DISCTOTAL" | "TOTALDISCS" => ItemKey::DiscTotal,
        "YEAR" => ItemKey::Year,
        "DATE" => ItemKey::RecordingDate,
        "GENRE" => ItemKey::Genre,
        "COMMENT" => ItemKey::Comment,
        "COMPOSER" => ItemKey::Composer,
        "CONDUCTOR" => ItemKey::Conductor,
        "LYRICIST" => ItemKey::Lyricist,
        "PUBLISHER" => ItemKey::Publisher,
        "LABEL" => ItemKey::Label,
        "CATALOGNUMBER" => ItemKey::CatalogNumber,
        "BARCODE" => ItemKey::Barcode,
        "ISRC" => ItemKey::Isrc,
        "REPLAYGAIN_TRACK_GAIN" => ItemKey::ReplayGainTrackGain,
        "REPLAYGAIN_TRACK_PEAK" => ItemKey::ReplayGainTrackPeak,
        "REPLAYGAIN_ALBUM_GAIN" => ItemKey::ReplayGainAlbumGain,
        "REPLAYGAIN_ALBUM_PEAK" => ItemKey::ReplayGainAlbumPeak,
        "MUSICBRAINZ_TRACKID" => ItemKey::MusicBrainzRecordingId,
        "MUSICBRAINZ_RELEASETRACKID" => ItemKey::MusicBrainzTrackId,
        "MUSICBRAINZ_ALBUMID" => ItemKey::MusicBrainzReleaseId,
        "MUSICBRAINZ_RELEASEGROUPID" => ItemKey::MusicBrainzReleaseGroupId,
        "MUSICBRAINZ_ARTISTID" => ItemKey::MusicBrainzArtistId,
        "MUSICBRAINZ_ALBUMARTISTID" => ItemKey::MusicBrainzReleaseArtistId,
        "MUSICBRAINZ_WORKID" => ItemKey::MusicBrainzWorkId,
        "BPM" | "TBPM" => ItemKey::Bpm,
        "KEY" | "INITIALKEY" => ItemKey::InitialKey,
        "MOOD" => ItemKey::Mood,
        "LYRICS" | "UNSYNCEDLYRICS" => ItemKey::Lyrics,
        "ENCODER" => ItemKey::EncoderSoftware,
        "ENCODERSETTINGS" => ItemKey::EncoderSettings,
        "COPYRIGHT" => ItemKey::CopyrightMessage,
        "LICENSE" => ItemKey::License,
        "REMIXER" => ItemKey::Remixer,
        "DJMIXER" => ItemKey::MixDj,
        "MIXER" => ItemKey::MixEngineer,
        "PRODUCER" => ItemKey::Producer,
        "ENGINEER" => ItemKey::Engineer,
        "PERFORMER" => ItemKey::Performer,
        "ARRANGER" => ItemKey::Arranger,
        "WRITER" => ItemKey::Writer,
        "DIRECTOR" => ItemKey::Director,
        "WORK" => ItemKey::Work,
        "MOVEMENT" => ItemKey::Movement,
        "MOVEMENTNUMBER" => ItemKey::MovementNumber,
        "MOVEMENTTOTAL" => ItemKey::MovementTotal,
        "SHOWNAME" => ItemKey::ShowName,
        "LANGUAGE" => ItemKey::Language,
        "SCRIPT" => ItemKey::Script,
        "DESCRIPTION" => ItemKey::Description,
        "ORIGINALALBUM" => ItemKey::OriginalAlbumTitle,
        "ORIGINALARTIST" => ItemKey::OriginalArtist,
        "ORIGINALLYRICIST" => ItemKey::OriginalLyricist,
        "ORIGINALDATE" => ItemKey::OriginalReleaseDate,
        "COMPILATION" => ItemKey::FlagCompilation,
        // Unknown keys are stored as-is
        other => ItemKey::Unknown(other.to_string()),
    }
}

/// Convert TagType to human-readable string
fn tag_type_to_string(tag_type: TagType) -> String {
    match tag_type {
        TagType::Id3v1 => "ID3v1".to_string(),
        TagType::Id3v2 => "ID3v2".to_string(),
        TagType::VorbisComments => "Vorbis Comments".to_string(),
        TagType::Mp4Ilst => "MP4 (iTunes)".to_string(),
        TagType::Ape => "APE".to_string(),
        TagType::RiffInfo => "RIFF INFO".to_string(),
        TagType::AiffText => "AIFF Text".to_string(),
        _ => "Unknown".to_string(),
    }
}

/// Extract all tags from a Tag object
fn extract_tags_from_tag(tag: &Tag) -> Vec<TagEntry> {
    let mut tags = Vec::new();

    for item in tag.items() {
        let key = item_key_to_string(item.key());
        let value = match item.value() {
            ItemValue::Text(s) => s.clone(),
            ItemValue::Locator(s) => s.clone(),
            ItemValue::Binary(b) => format!("<binary: {} bytes>", b.len()),
        };
        tags.push(TagEntry { key, value });
    }

    // Sort tags alphabetically by key for consistent display
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    tags
}

/// Get the full file path for a song
async fn get_song_file_path(
    pool: &sqlx::SqlitePool,
    song_id: &str,
) -> Result<(crate::db::models::Song, PathBuf), (StatusCode, Json<ErrorResponse>)> {
    // Get song from database
    let song = match queries::get_song_by_id(pool, song_id).await {
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
    let music_folders = queries::get_music_folders(pool).await.map_err(|e| {
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
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let (song, full_path) = match get_song_file_path(&state.pool, &id).await {
        Ok(result) => result,
        Err(e) => return e.into_response(),
    };

    // Read tags from file (blocking operation)
    let path_clone = full_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let tagged_file = Probe::open(&path_clone)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .options(ParseOptions::new().read_properties(false))
            .read()
            .map_err(|e| format!("Failed to read tags: {}", e))?;

        let mut primary_tags = Vec::new();
        let mut additional_tag_blocks = Vec::new();
        let mut primary_tag_type = None;

        // Get primary tag
        if let Some(tag) = tagged_file.primary_tag() {
            primary_tag_type = Some(tag_type_to_string(tag.tag_type()));
            primary_tags = extract_tags_from_tag(tag);
        }

        // Get additional tags
        for tag in tagged_file.tags() {
            let tag_type_str = tag_type_to_string(tag.tag_type());
            if Some(&tag_type_str) != primary_tag_type.as_ref() {
                additional_tag_blocks.push(AdditionalTagBlock {
                    tag_type: tag_type_str,
                    tags: extract_tags_from_tag(tag),
                });
            }
        }

        Ok::<_, String>((primary_tag_type, primary_tags, additional_tag_blocks))
    })
    .await;

    match result {
        Ok(Ok((tag_type, tags, additional_tags))) => Json(GetTagsResponse {
            id: song.id,
            file_path: song.file_path,
            file_format: song.file_format,
            editing_enabled: !state.config.music.readonly_tags,
            tag_type,
            tags,
            additional_tags,
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

/// PATCH /api/songs/:id/tags
///
/// Update tags in a song file. Requires `readonly_tags = false` in config.
pub async fn update_tags(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateTagsRequest>,
) -> impl IntoResponse {
    // Check if editing is enabled
    if state.config.music.readonly_tags {
        return (
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::with_details(
                "Tag editing is disabled",
                "Set `readonly_tags = false` in config to enable tag editing",
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

    let (_song, full_path) = match get_song_file_path(&state.pool, &id).await {
        Ok(result) => result,
        Err(e) => return e.into_response(),
    };

    // Check if artist/album changes that would require rescan
    let rescan_keys = [
        "ARTIST",
        "ALBUM",
        "ALBUMARTIST",
        "TITLE",
        "TRACKNUMBER",
        "DISCNUMBER",
        "YEAR",
        "GENRE",
    ];
    let rescan_recommended = request
        .set
        .iter()
        .any(|t| rescan_keys.contains(&t.key.to_uppercase().as_str()))
        || request
            .delete
            .iter()
            .any(|k| rescan_keys.contains(&k.to_uppercase().as_str()));

    // Perform tag update (blocking operation)
    let set_tags = request.set;
    let delete_tags = request.delete;
    let path_clone = full_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        // Open and read the file
        let mut tagged_file = Probe::open(&path_clone)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .read()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // Get or create primary tag
        let tag = match tagged_file.primary_tag_mut() {
            Some(tag) => tag,
            None => {
                // Determine best tag type for format
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
                tagged_file.primary_tag_mut().unwrap()
            }
        };

        let mut changes = Vec::new();

        // Process deletions first
        for key_str in &delete_tags {
            let item_key = string_to_item_key(key_str);

            // Get old value before deletion
            let old_value = tag.get_string(&item_key).map(|s| s.to_string());

            if old_value.is_some() {
                // Remove the tag
                tag.remove_key(&item_key);
                changes.push(TagChange {
                    key: key_str.clone(),
                    action: "deleted".to_string(),
                    old_value,
                    new_value: None,
                });
            }
        }

        // Process sets
        for entry in &set_tags {
            let item_key = string_to_item_key(&entry.key);

            // Get old value
            let old_value = tag.get_string(&item_key).map(|s| s.to_string());

            // Set new value
            // Use the appropriate setter based on key type for better compatibility
            match &item_key {
                ItemKey::TrackTitle => tag.set_title(entry.value.clone()),
                ItemKey::TrackArtist => tag.set_artist(entry.value.clone()),
                ItemKey::AlbumTitle => tag.set_album(entry.value.clone()),
                ItemKey::TrackNumber => {
                    if let Ok(n) = entry.value.parse::<u32>() {
                        tag.set_track(n);
                    } else {
                        // Store as string for complex values like "1/12"
                        tag.insert(TagItem::new(
                            item_key.clone(),
                            ItemValue::Text(entry.value.clone()),
                        ));
                    }
                }
                ItemKey::DiscNumber => {
                    if let Ok(n) = entry.value.parse::<u32>() {
                        tag.set_disk(n);
                    } else {
                        tag.insert(TagItem::new(
                            item_key.clone(),
                            ItemValue::Text(entry.value.clone()),
                        ));
                    }
                }
                ItemKey::Year => {
                    if let Ok(y) = entry.value.parse::<u32>() {
                        tag.set_year(y);
                    } else {
                        tag.insert(TagItem::new(
                            item_key.clone(),
                            ItemValue::Text(entry.value.clone()),
                        ));
                    }
                }
                ItemKey::Genre => tag.set_genre(entry.value.clone()),
                ItemKey::Comment => tag.set_comment(entry.value.clone()),
                _ => {
                    // Generic insert for other keys
                    tag.insert(TagItem::new(
                        item_key.clone(),
                        ItemValue::Text(entry.value.clone()),
                    ));
                }
            }

            // Only record as change if value actually changed
            if old_value.as_deref() != Some(&entry.value) {
                changes.push(TagChange {
                    key: entry.key.clone(),
                    action: "set".to_string(),
                    old_value,
                    new_value: Some(entry.value.clone()),
                });
            }
        }

        if changes.is_empty() {
            return Ok((changes, false));
        }

        // Save the file
        tagged_file
            .save_to_path(&path_clone, WriteOptions::default())
            .map_err(|e| format!("Failed to save file: {}", e))?;

        Ok::<_, String>((changes, true))
    })
    .await;

    match result {
        Ok(Ok((changes, saved))) => {
            if !saved {
                return Json(UpdateTagsResponse {
                    success: true,
                    message: "No changes were needed".to_string(),
                    changes: vec![],
                    rescan_recommended: false,
                })
                .into_response();
            }

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
