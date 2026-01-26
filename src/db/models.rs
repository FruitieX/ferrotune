// Many model structs are defined for completeness and future use
#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    /// Argon2 hash of the password for direct password authentication
    pub password_hash: String,
    pub email: Option<String>,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
    /// Plaintext password for OpenSubsonic token+salt authentication (MD5-based)
    /// This is required for legacy Subsonic protocol compatibility.
    /// For better security, users should use API key authentication.
    pub subsonic_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiKey {
    pub token: String,
    pub user_id: i64,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Artist {
    pub id: String,
    pub name: String,
    pub sort_name: Option<String>,
    pub album_count: i64,
    pub cover_art_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Album {
    pub id: String,
    pub name: String,
    pub artist_id: String,
    pub artist_name: String,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub song_count: i64,
    pub duration: i64,
    pub created_at: DateTime<Utc>,
    pub cover_art_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub artist_id: String,
    pub artist_name: String,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub cover_art_hash: Option<String>,
    // Optional fields populated via JOINs when needed
    /// Play count from scrobbles table (populated via JOIN)
    #[sqlx(default)]
    pub play_count: Option<i64>,
    /// Last played timestamp from scrobbles table (populated via JOIN)
    #[sqlx(default)]
    pub last_played: Option<DateTime<Utc>>,
    /// Starred timestamp from starred table (populated via JOIN)
    #[sqlx(default)]
    pub starred_at: Option<DateTime<Utc>>,
}

/// Song with its music library enabled status
/// Used for playlist display where we want to show metadata even for songs from disabled libraries
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SongWithLibraryStatus {
    pub id: String,
    pub title: String,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub artist_id: String,
    pub artist_name: String,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub cover_art_hash: Option<String>,
    /// Whether the music library this song belongs to is enabled
    pub library_enabled: bool,
    #[sqlx(default)]
    pub play_count: Option<i64>,
    #[sqlx(default)]
    pub last_played: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub starred_at: Option<DateTime<Utc>>,
}

impl SongWithLibraryStatus {
    /// Converts to a Song, discarding the library_enabled flag
    pub fn into_song(self) -> Song {
        Song {
            id: self.id,
            title: self.title,
            album_id: self.album_id,
            album_name: self.album_name,
            artist_id: self.artist_id,
            artist_name: self.artist_name,
            track_number: self.track_number,
            disc_number: self.disc_number,
            year: self.year,
            genre: self.genre,
            duration: self.duration,
            bitrate: self.bitrate,
            file_path: self.file_path,
            file_size: self.file_size,
            file_format: self.file_format,
            created_at: self.created_at,
            updated_at: self.updated_at,
            cover_art_hash: self.cover_art_hash,
            play_count: self.play_count,
            last_played: self.last_played,
            starred_at: self.starred_at,
        }
    }
}

/// Song with its music folder path for full filesystem path construction
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SongWithFolder {
    pub id: String,
    pub title: String,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub artist_id: String,
    pub artist_name: String,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub cover_art_hash: Option<String>,
    /// The base path of the music folder this song belongs to
    pub folder_path: Option<String>,
    // Optional fields populated via JOINs when needed
    #[sqlx(default)]
    pub play_count: Option<i64>,
    #[sqlx(default)]
    pub last_played: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub starred_at: Option<DateTime<Utc>>,
}

impl SongWithFolder {
    /// Converts to a Song, discarding the folder_path
    pub fn into_song(self) -> Song {
        Song {
            id: self.id,
            title: self.title,
            album_id: self.album_id,
            album_name: self.album_name,
            artist_id: self.artist_id,
            artist_name: self.artist_name,
            track_number: self.track_number,
            disc_number: self.disc_number,
            year: self.year,
            genre: self.genre,
            duration: self.duration,
            bitrate: self.bitrate,
            file_path: self.file_path,
            file_size: self.file_size,
            file_format: self.file_format,
            created_at: self.created_at,
            updated_at: self.updated_at,
            cover_art_hash: self.cover_art_hash,
            play_count: self.play_count,
            last_played: self.last_played,
            starred_at: self.starred_at,
        }
    }

    /// Gets the full filesystem path if folder_path is available
    pub fn full_path(&self) -> Option<String> {
        self.folder_path
            .as_ref()
            .map(|fp| format!("{}/{}", fp, self.file_path))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MusicFolder {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub enabled: bool,
    pub watch_enabled: bool,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub scan_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Starred {
    pub user_id: i64,
    pub item_type: String,
    pub item_id: String,
    pub starred_at: DateTime<Utc>,
}

/// Item type for starred/ratings - provides type safety instead of string literals
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Song,
    Album,
    Artist,
}

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemType::Song => "song",
            ItemType::Album => "album",
            ItemType::Artist => "artist",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "song" => Some(ItemType::Song),
            "album" => Some(ItemType::Album),
            "artist" => Some(ItemType::Artist),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub comment: Option<String>,
    pub owner_id: i64,
    pub is_public: bool,
    pub song_count: i64,
    pub duration: i64,
    pub folder_id: Option<String>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub owner_id: i64,
    pub position: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistSong {
    pub playlist_id: String,
    pub song_id: Option<String>,
    pub position: i64,
    pub missing_entry_data: Option<String>,
    /// Unique identifier for this playlist entry (stable across reordering)
    pub entry_id: Option<String>,
}

/// Data for a playlist entry that couldn't be matched to a library song
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingEntryData {
    /// Track title
    pub title: Option<String>,
    /// Artist name
    pub artist: Option<String>,
    /// Album name
    pub album: Option<String>,
    /// Duration in milliseconds (if known)
    pub duration: Option<i32>,
    /// Original raw line from the playlist file
    pub raw: String,
}

// ============================================================================
// Smart Playlists
// ============================================================================

/// Smart playlist - a dynamic playlist based on filter rules
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SmartPlaylist {
    pub id: String,
    pub name: String,
    pub comment: Option<String>,
    pub owner_id: i64,
    pub is_public: bool,
    /// JSON-encoded filter rules
    pub rules_json: String,
    /// Sort field: 'playCount', 'lastPlayed', 'dateAdded', 'title', 'year', 'random', etc.
    pub sort_field: Option<String>,
    /// Sort direction: 'asc' or 'desc'
    pub sort_direction: Option<String>,
    /// Optional limit on number of songs
    pub max_songs: Option<i64>,
    /// Optional folder ID for organizing smart playlists
    pub folder_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Filter rules for a smart playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistRules {
    /// List of conditions to filter by
    pub conditions: Vec<SmartPlaylistCondition>,
    /// Logic for combining conditions: "and" or "or"
    #[serde(default = "default_logic")]
    pub logic: String,
}

fn default_logic() -> String {
    "and".to_string()
}

/// A single filter condition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistCondition {
    /// Field to filter on: 'year', 'genre', 'playCount', 'lastPlayed', 'dateAdded', 'starred', 'artist', 'album', etc.
    pub field: String,
    /// Comparison operator: 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'within'
    pub operator: String,
    /// Value to compare against (type depends on field/operator)
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Scrobble {
    pub id: i64,
    pub user_id: i64,
    pub song_id: String,
    pub played_at: DateTime<Utc>,
    pub submission: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserPreferences {
    pub user_id: i64,
    pub accent_color: String,
    pub custom_accent_hue: Option<f64>,
    pub custom_accent_lightness: Option<f64>,
    pub custom_accent_chroma: Option<f64>,
    pub preferences_json: String,
    pub updated_at: DateTime<Utc>,
}

/// Queue source type - determines where the queue came from
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum QueueSourceType {
    Library,
    Album,
    Artist,
    Playlist,
    SmartPlaylist,
    Genre,
    Search,
    Favorites,
    History,
    Directory,
    /// Non-recursive directory - only files in the current folder, not subfolders
    DirectoryFlat,
    #[default]
    Other,
}

impl QueueSourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            QueueSourceType::Library => "library",
            QueueSourceType::Album => "album",
            QueueSourceType::Artist => "artist",
            QueueSourceType::Playlist => "playlist",
            QueueSourceType::Genre => "genre",
            QueueSourceType::Search => "search",
            QueueSourceType::Favorites => "favorites",
            QueueSourceType::History => "history",
            QueueSourceType::Directory => "directory",
            QueueSourceType::DirectoryFlat => "directoryFlat",
            QueueSourceType::SmartPlaylist => "smartPlaylist",
            QueueSourceType::Other => "other",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "library" => QueueSourceType::Library,
            "album" => QueueSourceType::Album,
            "artist" => QueueSourceType::Artist,
            "playlist" => QueueSourceType::Playlist,
            "smartPlaylist" => QueueSourceType::SmartPlaylist,
            "genre" => QueueSourceType::Genre,
            "search" => QueueSourceType::Search,
            "favorites" => QueueSourceType::Favorites,
            "history" => QueueSourceType::History,
            "directory" => QueueSourceType::Directory,
            "directoryFlat" => QueueSourceType::DirectoryFlat,
            _ => QueueSourceType::Other,
        }
    }
}

/// Repeat mode for queue playback
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    #[default]
    Off,
    All,
    One,
}

impl RepeatMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::All => "all",
            RepeatMode::One => "one",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "all" => RepeatMode::All,
            "one" => RepeatMode::One,
            _ => RepeatMode::Off,
        }
    }
}

/// Server-side play queue state
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayQueue {
    pub user_id: i64,
    pub source_type: String,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
    pub current_index: i64,
    pub position_ms: i64,
    pub is_shuffled: bool,
    pub shuffle_seed: Option<i64>,
    pub shuffle_indices_json: Option<String>,
    pub repeat_mode: String,
    pub filters_json: Option<String>,
    pub sort_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub changed_by: String,
    /// Total count of songs in the queue (for lazy queues)
    pub total_count: Option<i64>,
    /// Whether this queue uses lazy materialization
    pub is_lazy: bool,
    /// Explicit song IDs for non-reconstructable queues (history, custom)
    pub song_ids_json: Option<String>,
    /// Unique identifier for this queue instance (UUID, generated on each queue start)
    pub instance_id: Option<String>,
}

impl PlayQueue {
    /// Get the source type as an enum
    pub fn source_type_enum(&self) -> QueueSourceType {
        QueueSourceType::from_str(&self.source_type)
    }

    /// Get the repeat mode as an enum
    pub fn repeat_mode_enum(&self) -> RepeatMode {
        RepeatMode::from_str(&self.repeat_mode)
    }

    /// Parse shuffle indices from JSON
    pub fn shuffle_indices(&self) -> Option<Vec<usize>> {
        self.shuffle_indices_json
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
    }

    /// Parse song IDs from JSON (for explicit ID queues)
    pub fn parse_song_ids(&self) -> Option<Vec<String>> {
        self.song_ids_json
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
    }
}

/// Queue entry - a song in the queue at a specific position
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayQueueEntry {
    pub user_id: i64,
    pub song_id: String,
    pub queue_position: i64,
    /// Unique identifier for this queue entry (allows same song multiple times)
    pub entry_id: String,
}

/// Queue entry with full song data - for API responses
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct QueueEntryWithSong {
    /// Unique identifier for this queue entry
    pub entry_id: String,
    /// Position in the queue
    pub queue_position: i64,
    /// Song ID
    pub id: String,
    pub title: String,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub artist_id: String,
    pub artist_name: String,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(default)]
    pub play_count: Option<i64>,
    #[sqlx(default)]
    pub last_played: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub starred_at: Option<DateTime<Utc>>,
    pub cover_art_hash: Option<String>,
}

// ============================================================================
// User Management Models
// ============================================================================

/// User with library access information
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserLibraryAccess {
    pub user_id: i64,
    pub music_folder_id: i64,
    pub created_at: DateTime<Utc>,
}

/// Playlist share record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistShare {
    pub playlist_id: String,
    pub shared_with_user_id: i64,
    pub can_edit: bool,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Tagger Models
// ============================================================================

/// Tagger session - stores per-user tagger state
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaggerSession {
    pub id: i64,
    pub user_id: i64,
    pub active_rename_script_id: Option<String>,
    pub active_tag_script_id: Option<String>,
    pub target_library_id: Option<String>,
    /// JSON array of visible column names
    pub visible_columns: String,
    /// JSON object of column widths
    pub column_widths: String,
    pub file_column_width: i64,
    pub show_library_prefix: bool,
    pub show_computed_path: bool,
    pub details_panel_open: bool,
    /// How to handle dangerous characters: 'ignore', 'strip', or 'replace'
    pub dangerous_char_mode: String,
    /// Character to replace dangerous characters with
    pub dangerous_char_replacement: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Track in a tagger session
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaggerSessionTrack {
    pub id: i64,
    pub session_id: i64,
    pub track_id: String,
    /// 'library' or 'staged'
    pub track_type: String,
    pub position: i64,
}

/// Pending edit for a track in a tagger session
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaggerPendingEdit {
    pub id: i64,
    pub session_id: i64,
    pub track_id: String,
    /// 'library' or 'staged'
    pub track_type: String,
    /// JSON object of edited tags
    pub edited_tags: String,
    pub computed_path: Option<String>,
    pub cover_art_removed: bool,
    /// Cover art as raw binary data
    #[serde(skip)]
    pub cover_art_data: Option<Vec<u8>>,
    /// MIME type for cover art (e.g., 'image/jpeg')
    pub cover_art_mime_type: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// User script for tagger
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaggerScript {
    pub id: String,
    pub user_id: i64,
    pub name: String,
    /// 'rename' or 'tags'
    #[sqlx(rename = "type")]
    pub script_type: String,
    pub script: String,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
