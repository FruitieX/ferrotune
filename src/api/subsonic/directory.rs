//! Directory-based browsing endpoints for filesystem navigation.
//!
//! These endpoints provide filesystem-based navigation as an alternative to
//! the ID3-based browsing (getArtists/getAlbum). They're particularly useful
//! for browsing libraries organized by folder structure.

use crate::api::common::browse::get_indexes_logic;
use crate::api::common::models::DirectoryIndex;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::{format_datetime_iso_ms, get_content_type_for_format};
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::db::models::ItemType;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
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

// DirectoryIndex and DirectoryArtist are imported from common::models

/// Returns the top-level directory index for all music folders.
/// Returns filesystem directories (grouped by first letter) to support true folder browsing.
pub async fn get_indexes(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetIndexesParams>,
) -> crate::error::Result<FormatResponse<IndexesResponse>> {
    let (indexes, last_modified) =
        get_indexes_logic(&state.database, user.user_id, params.music_folder_id).await?;

    let response = IndexesResponse {
        indexes: Indexes {
            shortcut: Vec::new(),
            index: indexes,
            child: Vec::new(),
            last_modified,
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
    #[ts(type = "number | undefined")]
    pub size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
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
    if let Some(artist) = crate::db::repo::browse::get_artist_by_id(&state.database, id).await? {
        let albums = crate::db::repo::browse::get_albums_by_artist_for_user(
            &state.database,
            id,
            user.user_id,
        )
        .await?;

        // Get starred and ratings for albums
        let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
        let starred_map =
            get_starred_map(&state.database, user.user_id, ItemType::Album, &album_ids).await?;
        let ratings_map =
            get_ratings_map(&state.database, user.user_id, ItemType::Album, &album_ids).await?;

        // Get starred for artist
        let artist_starred = get_starred_map(
            &state.database,
            user.user_id,
            ItemType::Artist,
            std::slice::from_ref(id),
        )
        .await?;
        let artist_rating = get_ratings_map(
            &state.database,
            user.user_id,
            ItemType::Artist,
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
                created: Some(format_datetime_iso_ms(album.created_at)),
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
    if let Some(album) = crate::db::repo::browse::get_album_by_id(&state.database, id).await? {
        let songs =
            crate::db::repo::browse::get_songs_by_album_for_user(&state.database, id, user.user_id)
                .await?;

        // Get starred and ratings for songs
        let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
        let starred_map =
            get_starred_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;
        let ratings_map =
            get_ratings_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;

        // Get starred for album
        let album_starred = get_starred_map(
            &state.database,
            user.user_id,
            ItemType::Album,
            std::slice::from_ref(id),
        )
        .await?;
        let album_rating = get_ratings_map(
            &state.database,
            user.user_id,
            ItemType::Album,
            std::slice::from_ref(id),
        )
        .await?;

        let children: Vec<DirectoryChild> = songs
            .iter()
            .map(|song| {
                let content_type = get_content_type_for_format(&song.file_format);

                DirectoryChild {
                    id: song.id.clone(),
                    parent: Some(id.clone()),
                    is_dir: false,
                    title: song.title.clone(),
                    artist: Some(song.artist_name.clone()),
                    album: Some(album.name.clone()),
                    cover_art: Some(song.id.clone()),
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
                    created: Some(format_datetime_iso_ms(song.created_at)),
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
    let (subdirs, songs) = get_directory_contents(&state.database, user.user_id, path_str).await?;

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
    let starred_map =
        get_starred_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;
    let ratings_map =
        get_ratings_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;

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
        let content_type = get_content_type_for_format(&song.file_format);

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
            created: Some(format_datetime_iso_ms(song.created_at)),
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

// get_top_level_directories was replaced by get_indexes_logic in common/browse.rs

#[derive(Debug)]
struct SubDirectory {
    name: String,
    path: String,
    cover_art: Option<String>,
}

/// Get subdirectories and songs within a specific directory path
async fn get_directory_contents(
    database: &crate::db::Database,
    user_id: i64,
    path: &str,
) -> crate::error::Result<(Vec<SubDirectory>, Vec<crate::db::models::Song>)> {
    // Normalize path to not have trailing slash
    let path = path.trim_end_matches('/');
    let path_prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{}/", path)
    };

    // Get all songs that start with this path prefix from enabled music folders
    let songs =
        crate::db::repo::browse::list_user_songs_by_path_prefix(database, user_id, &path_prefix)
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
