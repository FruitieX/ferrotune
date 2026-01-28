use serde::Serialize;
use ts_rs::TS;

// ===================================
// Artist / Album / Song basic structs
// ===================================

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumResponse {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub created: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

#[derive(Debug, Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    /// Cover art width in pixels (Ferrotune extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_width: Option<i32>,
    /// Cover art height in pixels (Ferrotune extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_height: Option<i32>,
    #[ts(type = "number")]
    pub size: i64,
    pub content_type: String,
    pub suffix: String,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    pub path: String,
    /// Full filesystem path (Ferrotune extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub created: String,
    #[serde(rename = "type")]
    pub media_type: String,
    // Ferrotune extensions for play statistics
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub play_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<String>,
    // Ferrotune extensions for ReplayGain
    /// ReplayGain track gain - prefers computed, falls back to original (in dB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_gain_track_gain: Option<f64>,
    /// ReplayGain track peak - prefers computed, falls back to original (linear, 0-1+)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_gain_track_peak: Option<f64>,
    /// ReplayGain track gain from original file tags (in dB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_replay_gain_track_gain: Option<f64>,
    /// ReplayGain track peak from original file tags (linear, 0-1+)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_replay_gain_track_peak: Option<f64>,
    /// ReplayGain track gain computed by scanner via EBU R128 (in dB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub computed_replay_gain_track_gain: Option<f64>,
    /// ReplayGain track peak computed by scanner via EBU R128 (linear, 0-1+)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub computed_replay_gain_track_peak: Option<f64>,
}

// ===================================
// Detail Structs
// ===================================

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistDetail {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumDetail {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub created: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub song: Vec<SongResponse>,
}

// ===================================
// Index Structs (ArtistsIndex, DirectoryIndex)
// ===================================

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistsIndex {
    pub index: Vec<ArtistIndex>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistIndex {
    pub name: String,
    pub artist: Vec<ArtistResponse>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryIndex {
    pub name: String,
    pub artist: Vec<DirectoryArtist>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryArtist {
    pub id: String,
    pub name: String,
    // These optional fields are used in Indexes but not in Ferrotune Indexes (yet, or Subsonic specific)
    // We'll include them as optional
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

// ===================================
// Genre Structs
// ===================================

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenresList {
    pub genre: Vec<GenreResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenreResponse {
    #[serde(rename = "value")]
    pub name: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub album_count: i64,
}

// ===================================
// Helper Structs
// ===================================

/// Play statistics for a song
#[derive(Default)]
pub struct SongPlayStats {
    pub play_count: Option<i64>,
    pub last_played: Option<String>,
}
