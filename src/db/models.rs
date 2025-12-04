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
    pub updated_at: DateTime<Utc>,
}
