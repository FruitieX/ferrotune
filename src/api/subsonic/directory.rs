//! Directory-based browsing endpoints for filesystem navigation.
//!
//! These endpoints provide filesystem-based navigation as an alternative to
//! the ID3-based browsing (getArtists/getAlbum). They're particularly useful
//! for browsing libraries organized by folder structure.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{get_ratings_map, get_starred_map};
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

// ===== getIndexes =====
// Returns an indexed structure of all top-level directories in music folders

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIndexesParams {
    music_folder_id: Option<i64>,
    #[allow(dead_code)]
    if_modified_since: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct IndexesResponse {
    pub indexes: Indexes,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct Indexes {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub shortcut: Vec<DirectoryChild>,
    pub index: Vec<DirectoryIndex>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub child: Vec<DirectoryChild>,
    #[ts(type = "number")]
    pub last_modified: i64,
    pub ignored_articles: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryIndex {
    pub name: String,
    pub artist: Vec<DirectoryArtist>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryArtist {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

/// Returns the top-level directory index for all music folders.
/// Each entry in the index represents an artist folder.
pub async fn get_indexes(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetIndexesParams>,
) -> crate::error::Result<FormatResponse<IndexesResponse>> {
    // Get all top-level directories from songs table
    // We group by the first path component after the music folder
    let directories = get_top_level_directories(&state.pool, params.music_folder_id).await?;

    // Get starred status for artists (directories map to artists)
    let dir_ids: Vec<String> = directories.iter().map(|d| d.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "artist", &dir_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "artist", &dir_ids).await?;

    // Group directories by first letter
    let mut grouped: HashMap<String, Vec<DirectoryArtist>> = HashMap::new();

    for dir in directories {
        let first_char = dir
            .name
            .chars()
            .next()
            .unwrap_or('#')
            .to_uppercase()
            .to_string();

        let index_name = if first_char.chars().next().unwrap().is_alphabetic() {
            first_char
        } else {
            "#".to_string()
        };

        grouped
            .entry(index_name)
            .or_default()
            .push(DirectoryArtist {
                id: dir.id.clone(),
                name: dir.name.clone(),
                starred: starred_map.get(&dir.id).cloned(),
                user_rating: ratings_map.get(&dir.id).copied(),
            });
    }

    // Sort into index list
    let mut indexes: Vec<DirectoryIndex> = grouped
        .into_iter()
        .map(|(name, mut artists)| {
            artists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            DirectoryIndex {
                name,
                artist: artists,
            }
        })
        .collect();

    indexes.sort_by(|a, b| {
        // Put # at the end
        match (a.name.as_str(), b.name.as_str()) {
            ("#", "#") => std::cmp::Ordering::Equal,
            ("#", _) => std::cmp::Ordering::Greater,
            (_, "#") => std::cmp::Ordering::Less,
            _ => a.name.cmp(&b.name),
        }
    });

    let response = IndexesResponse {
        indexes: Indexes {
            shortcut: Vec::new(),
            index: indexes,
            child: Vec::new(),
            last_modified: chrono::Utc::now().timestamp_millis(),
            ignored_articles: "The El La Los Las Le Les".to_string(),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getMusicDirectory =====
// Returns the contents of a directory

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMusicDirectoryParams {
    id: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryResponse {
    pub directory: Directory,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct Directory {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub child: Vec<DirectoryChild>,
}

#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryChild {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub is_dir: bool,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    // Song-specific fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
}

/// Returns the contents of a music directory.
/// The ID can be:
/// - An artist ID (returns albums for that artist)
/// - An album ID (returns songs in that album)
/// - A directory path identifier for filesystem-based navigation
pub async fn get_music_directory(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetMusicDirectoryParams>,
) -> crate::error::Result<FormatResponse<DirectoryResponse>> {
    let id = &params.id;

    // Check if it's a directory path ID (starts with "dir-")
    if let Some(path) = id.strip_prefix("dir-") {
        return get_directory_by_path(user, state, path).await;
    }

    // First, try to find as an artist
    if let Some(artist) = crate::db::queries::get_artist_by_id(&state.pool, id).await? {
        let albums = crate::db::queries::get_albums_by_artist(&state.pool, id).await?;

        // Get starred and ratings for albums
        let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
        let starred_map = get_starred_map(&state.pool, user.user_id, "album", &album_ids).await?;
        let ratings_map = get_ratings_map(&state.pool, user.user_id, "album", &album_ids).await?;

        // Get starred for artist
        let artist_starred = get_starred_map(
            &state.pool,
            user.user_id,
            "artist",
            std::slice::from_ref(id),
        )
        .await?;
        let artist_rating = get_ratings_map(
            &state.pool,
            user.user_id,
            "artist",
            std::slice::from_ref(id),
        )
        .await?;

        let children: Vec<DirectoryChild> = albums
            .iter()
            .map(|album| DirectoryChild {
                id: album.id.clone(),
                parent: Some(id.clone()),
                is_dir: true,
                title: album.name.clone(),
                artist: Some(album.artist_name.clone()),
                album: None,
                cover_art: Some(album.id.clone()),
                year: album.year,
                genre: album.genre.clone(),
                track: None,
                size: None,
                content_type: None,
                suffix: None,
                duration: Some(album.duration),
                bit_rate: None,
                path: None,
                starred: starred_map.get(&album.id).cloned(),
                user_rating: ratings_map.get(&album.id).copied(),
                created: Some(
                    album
                        .created_at
                        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                        .to_string(),
                ),
            })
            .collect();

        let response = DirectoryResponse {
            directory: Directory {
                id: artist.id.clone(),
                parent: None,
                name: artist.name,
                starred: artist_starred.get(&artist.id).cloned(),
                user_rating: artist_rating.get(&artist.id).copied(),
                child: children,
            },
        };

        return Ok(FormatResponse::new(user.format, response));
    }

    // Try to find as an album
    if let Some(album) = crate::db::queries::get_album_by_id(&state.pool, id).await? {
        let songs = crate::db::queries::get_songs_by_album(&state.pool, id).await?;

        // Get starred and ratings for songs
        let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
        let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
        let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

        // Get starred for album
        let album_starred =
            get_starred_map(&state.pool, user.user_id, "album", std::slice::from_ref(id)).await?;
        let album_rating =
            get_ratings_map(&state.pool, user.user_id, "album", std::slice::from_ref(id)).await?;

        let children: Vec<DirectoryChild> = songs
            .iter()
            .map(|song| {
                let content_type = match song.file_format.as_str() {
                    "mp3" => "audio/mpeg",
                    "flac" => "audio/flac",
                    "ogg" | "opus" => "audio/ogg",
                    "m4a" | "mp4" | "aac" => "audio/mp4",
                    "wav" => "audio/wav",
                    _ => "application/octet-stream",
                };

                DirectoryChild {
                    id: song.id.clone(),
                    parent: Some(id.clone()),
                    is_dir: false,
                    title: song.title.clone(),
                    artist: Some(song.artist_name.clone()),
                    album: Some(album.name.clone()),
                    cover_art: Some(album.id.clone()),
                    year: song.year,
                    genre: song.genre.clone(),
                    track: song.track_number,
                    size: Some(song.file_size),
                    content_type: Some(content_type.to_string()),
                    suffix: Some(song.file_format.clone()),
                    duration: Some(song.duration),
                    bit_rate: song.bitrate,
                    path: Some(song.file_path.clone()),
                    starred: starred_map.get(&song.id).cloned(),
                    user_rating: ratings_map.get(&song.id).copied(),
                    created: Some(song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
                }
            })
            .collect();

        let response = DirectoryResponse {
            directory: Directory {
                id: album.id.clone(),
                parent: Some(album.artist_id.clone()),
                name: album.name,
                starred: album_starred.get(&album.id).cloned(),
                user_rating: album_rating.get(&album.id).copied(),
                child: children,
            },
        };

        return Ok(FormatResponse::new(user.format, response));
    }

    Err(crate::error::Error::NotFound(format!(
        "Directory {} not found",
        id
    )))
}

/// Get directory contents by filesystem path
async fn get_directory_by_path(
    user: AuthenticatedUser,
    state: Arc<AppState>,
    path: &str,
) -> crate::error::Result<FormatResponse<DirectoryResponse>> {
    // Decode the path (it's URL-encoded in the ID)
    let decoded_path = urlencoding::decode(path)
        .map_err(|_| crate::error::Error::InvalidRequest("Invalid path encoding".to_string()))?;

    let path_str = decoded_path.as_ref();

    // Get subdirectories and songs in this directory path
    let (subdirs, songs) = get_directory_contents(&state.pool, path_str).await?;

    // Get parent path
    let parent = std::path::Path::new(path_str)
        .parent()
        .and_then(|p| p.to_str())
        .filter(|s| !s.is_empty())
        .map(|p| format!("dir-{}", urlencoding::encode(p)));

    // Get directory name
    let name = std::path::Path::new(path_str)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path_str)
        .to_string();

    // Get starred and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    let mut children: Vec<DirectoryChild> = Vec::new();

    // Add subdirectories
    for subdir in subdirs {
        children.push(DirectoryChild {
            id: format!("dir-{}", urlencoding::encode(&subdir.path)),
            parent: Some(format!("dir-{}", urlencoding::encode(path_str))),
            is_dir: true,
            title: subdir.name,
            artist: None,
            album: None,
            cover_art: subdir.cover_art,
            year: None,
            genre: None,
            track: None,
            size: None,
            content_type: None,
            suffix: None,
            duration: None,
            bit_rate: None,
            path: Some(subdir.path),
            starred: None,
            user_rating: None,
            created: None,
        });
    }

    // Add songs
    for song in songs {
        let content_type = match song.file_format.as_str() {
            "mp3" => "audio/mpeg",
            "flac" => "audio/flac",
            "ogg" | "opus" => "audio/ogg",
            "m4a" | "mp4" | "aac" => "audio/mp4",
            "wav" => "audio/wav",
            _ => "application/octet-stream",
        };

        children.push(DirectoryChild {
            id: song.id.clone(),
            parent: Some(format!("dir-{}", urlencoding::encode(path_str))),
            is_dir: false,
            title: song.title.clone(),
            artist: Some(song.artist_name.clone()),
            album: song.album_name.clone(),
            cover_art: song.album_id.clone().or_else(|| Some(song.id.clone())),
            year: song.year,
            genre: song.genre.clone(),
            track: song.track_number,
            size: Some(song.file_size),
            content_type: Some(content_type.to_string()),
            suffix: Some(song.file_format.clone()),
            duration: Some(song.duration),
            bit_rate: song.bitrate,
            path: Some(song.file_path.clone()),
            starred: starred_map.get(&song.id).cloned(),
            user_rating: ratings_map.get(&song.id).copied(),
            created: Some(song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
        });
    }

    let response = DirectoryResponse {
        directory: Directory {
            id: format!("dir-{}", urlencoding::encode(path_str)),
            parent,
            name,
            starred: None,
            user_rating: None,
            child: children,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== Helper Types and Functions =====

#[derive(Debug)]
struct TopLevelDirectory {
    id: String,
    name: String,
}

#[derive(Debug)]
struct SubDirectory {
    name: String,
    path: String,
    cover_art: Option<String>,
}

/// Get all top-level directories (artist folders) from the songs table.
/// This extracts the first path component from each song's file_path.
async fn get_top_level_directories(
    pool: &sqlx::SqlitePool,
    music_folder_id: Option<i64>,
) -> crate::error::Result<Vec<TopLevelDirectory>> {
    // We use artists as the top level, since that's what we have indexed
    // This provides compatibility with getArtists while also being filesystem-aware
    let artists: Vec<(String, String)> = if let Some(folder_id) = music_folder_id {
        sqlx::query_as(
            r#"
            SELECT DISTINCT a.id, a.name
            FROM artists a
            INNER JOIN songs s ON s.artist_id = a.id
            WHERE s.music_folder_id = ?
            ORDER BY a.sort_name COLLATE NOCASE, a.name COLLATE NOCASE
            "#,
        )
        .bind(folder_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT id, name
            FROM artists
            ORDER BY sort_name COLLATE NOCASE, name COLLATE NOCASE
            "#,
        )
        .fetch_all(pool)
        .await?
    };

    Ok(artists
        .into_iter()
        .map(|(id, name)| TopLevelDirectory { id, name })
        .collect())
}

/// Get subdirectories and songs within a specific directory path
async fn get_directory_contents(
    pool: &sqlx::SqlitePool,
    path: &str,
) -> crate::error::Result<(Vec<SubDirectory>, Vec<crate::db::models::Song>)> {
    // Normalize path to not have trailing slash
    let path = path.trim_end_matches('/');
    let path_prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{}/", path)
    };

    // Get all songs that start with this path prefix
    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        r#"
        SELECT s.*, a.name as artist_name, al.name as album_name
        FROM songs s
        LEFT JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.file_path LIKE ? || '%'
        ORDER BY s.file_path
        "#,
    )
    .bind(&path_prefix)
    .fetch_all(pool)
    .await?;

    // Separate into direct children (songs in this folder) and subdirectories
    let mut direct_songs: Vec<crate::db::models::Song> = Vec::new();
    let mut subdirs: std::collections::HashSet<String> = std::collections::HashSet::new();

    for song in songs {
        // Get the relative path after the prefix
        let relative_path = song
            .file_path
            .strip_prefix(&path_prefix)
            .unwrap_or(&song.file_path);

        if relative_path.contains('/') {
            // This song is in a subdirectory
            let first_component = relative_path.split('/').next().unwrap();
            subdirs.insert(first_component.to_string());
        } else {
            // This song is directly in this folder
            direct_songs.push(song);
        }
    }

    // Convert subdirs to SubDirectory structs
    let subdirectories: Vec<SubDirectory> = subdirs
        .into_iter()
        .map(|name| {
            let full_path = if path.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", path, name)
            };
            SubDirectory {
                name,
                path: full_path,
                cover_art: None, // Could be enhanced to find cover art in subdirectory
            }
        })
        .collect();

    Ok((subdirectories, direct_songs))
}
