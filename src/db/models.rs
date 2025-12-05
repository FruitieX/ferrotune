use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub email: Option<String>,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Starred {
    pub user_id: i64,
    pub item_type: String,
    pub item_id: String,
    pub starred_at: DateTime<Utc>,
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
    pub song_id: String,
    pub position: i64,
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
    Genre,
    Search,
    Favorites,
    History,
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
            QueueSourceType::Other => "other",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "library" => QueueSourceType::Library,
            "album" => QueueSourceType::Album,
            "artist" => QueueSourceType::Artist,
            "playlist" => QueueSourceType::Playlist,
            "genre" => QueueSourceType::Genre,
            "search" => QueueSourceType::Search,
            "favorites" => QueueSourceType::Favorites,
            "history" => QueueSourceType::History,
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
}
