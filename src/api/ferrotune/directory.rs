//! Paginated directory browsing endpoint for the Ferrotune API.
//!
//! This provides an enhanced directory browser with pagination, sorting,
//! filtering, and folder size information.

use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::get_content_type_for_format;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{get_song_thumbnails_base64, InlineImagesParam};
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::error::{Error, FerrotuneApiResult};
use axum::extract::{Query, State};
use axum::response::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Libraries endpoint - list user-accessible music folders
// ============================================================================

/// Response for listing accessible libraries
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LibrariesResponse {
    pub libraries: Vec<LibraryInfo>,
}

/// Information about a library (music folder)
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LibraryInfo {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub total_size: i64,
}

/// Get libraries accessible to the current user
pub async fn get_libraries(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<LibrariesResponse>> {
    let folders = crate::db::queries::get_music_folders_for_user(&state.pool, user.user_id).await?;

    let mut libraries = Vec::new();
    for folder in folders {
        // Get stats for this folder
        let stats: (i64, i64) = sqlx::query_as(
            r#"
            SELECT COUNT(*) as file_count, COALESCE(SUM(file_size), 0) as total_size
            FROM songs
            WHERE music_folder_id = ?
            "#,
        )
        .bind(folder.id)
        .fetch_one(&state.pool)
        .await?;

        libraries.push(LibraryInfo {
            id: folder.id,
            name: folder.name,
            song_count: stats.0,
            total_size: stats.1,
        });
    }

    Ok(Json(LibrariesResponse { libraries }))
}

// ============================================================================
// Directory endpoint - browse within a library
// ============================================================================

/// Parameters for paginated directory listing
#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetDirectoryPagedParams {
    /// Library ID (music folder ID) - required to browse within a library
    #[ts(type = "number | null")]
    pub library_id: Option<i64>,
    /// Directory path relative to library root (empty string or omitted for library root)
    pub path: Option<String>,
    /// Number of items per page (default 100, max 500)
    pub count: Option<u32>,
    /// Offset for pagination
    pub offset: Option<u32>,
    /// Sort field: name, artist, album, year, duration, size, dateAdded
    pub sort: Option<String>,
    /// Sort direction: asc, desc
    pub sort_dir: Option<String>,
    /// Filter text to match against name, artist, album
    pub filter: Option<String>,
    /// Filter to show only folders
    pub folders_only: Option<bool>,
    /// Filter to show only files (songs)
    pub files_only: Option<bool>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(flatten)]
    #[ts(skip)]
    pub inline_images: InlineImagesParam,
}

/// Paginated directory response
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryPagedResponse {
    /// Library ID this directory belongs to
    #[ts(type = "number")]
    pub library_id: i64,
    /// Library name
    pub library_name: String,
    /// Directory path relative to library root (empty string for library root)
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub name: String,
    /// Total number of children (before pagination)
    #[ts(type = "number")]
    pub total: i64,
    /// Total number of folders
    #[ts(type = "number")]
    pub folder_count: i64,
    /// Total number of files (songs)
    #[ts(type = "number")]
    pub file_count: i64,
    /// Total size of all files in directory (bytes)
    #[ts(type = "number")]
    pub total_size: i64,
    /// Children on this page
    pub children: Vec<DirectoryChildPaged>,
    /// Breadcrumb path from library root
    pub breadcrumbs: Vec<BreadcrumbItem>,
}

#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BreadcrumbItem {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryChildPaged {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub is_dir: bool,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded cover art thumbnail data (only present if inlineImages requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
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
    /// Folder size in bytes (total size of all files in folder)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub folder_size: Option<i64>,
    /// Number of files in folder
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub child_count: Option<i64>,
}

/// Get paginated directory contents with sorting and filtering
pub async fn get_directory_paged(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetDirectoryPagedParams>,
) -> FerrotuneApiResult<Json<DirectoryPagedResponse>> {
    let count = params.count.unwrap_or(100).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;
    let inline_size = params.inline_images.get_size();

    // Library ID is required
    let library_id = params
        .library_id
        .ok_or_else(|| Error::InvalidRequest("libraryId is required".to_string()))?;

    let has_access =
        crate::api::ferrotune::users::user_has_folder_access(&state.pool, user.user_id, library_id)
            .await?;
    if !has_access {
        return Err(Error::Forbidden("Access denied to library".to_string()).into());
    }

    // Get the music folder
    let folder: crate::db::models::MusicFolder =
        sqlx::query_as("SELECT * FROM music_folders WHERE id = ? AND enabled = 1")
            .bind(library_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| Error::NotFound("Library not found".to_string()))?;

    // Get the relative path (empty string means library root)
    let relative_path = params.path.clone().unwrap_or_default();
    let relative_path = relative_path.trim_matches('/').to_string();

    // Build the absolute path
    let absolute_path = if relative_path.is_empty() {
        folder.path.clone()
    } else {
        format!("{}/{}", folder.path, relative_path)
    };

    // Build breadcrumbs from relative path
    let breadcrumbs = build_breadcrumbs_for_library(&relative_path);

    // Get parent path (relative)
    let parent = if relative_path.is_empty() {
        None
    } else {
        let parent_path = std::path::Path::new(&relative_path)
            .parent()
            .and_then(|p| p.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        Some(parent_path)
    };

    // Get directory name
    let name = if relative_path.is_empty() {
        folder.name.clone()
    } else {
        std::path::Path::new(&relative_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&relative_path)
            .to_string()
    };

    // Get directory contents with stats
    let (children, stats) = get_directory_contents_for_library(
        &state.pool,
        user.user_id,
        library_id,
        &folder.path,
        &relative_path,
        &absolute_path,
        count,
        offset,
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
        params.filter.as_deref(),
        params.folders_only.unwrap_or(false),
        params.files_only.unwrap_or(false),
        inline_size,
    )
    .await?;

    let response = DirectoryPagedResponse {
        library_id,
        library_name: folder.name,
        path: relative_path,
        parent,
        name,
        total: stats.total_count,
        folder_count: stats.folder_count,
        file_count: stats.file_count,
        total_size: stats.total_size,
        children,
        breadcrumbs,
    };

    Ok(Json(response))
}

/// Statistics for a directory
struct DirectoryStats {
    total_count: i64,
    folder_count: i64,
    file_count: i64,
    total_size: i64,
}

/// Build breadcrumbs for a relative path within a library
fn build_breadcrumbs_for_library(relative_path: &str) -> Vec<BreadcrumbItem> {
    if relative_path.is_empty() {
        return vec![];
    }

    let mut breadcrumbs = vec![];
    let mut current_path = String::new();

    for component in relative_path.split('/') {
        if component.is_empty() {
            continue;
        }
        if current_path.is_empty() {
            current_path = component.to_string();
        } else {
            current_path = format!("{}/{}", current_path, component);
        }
        breadcrumbs.push(BreadcrumbItem {
            id: current_path.clone(),
            name: component.to_string(),
        });
    }

    breadcrumbs
}

/// Get paginated directory contents for a library
#[allow(clippy::too_many_arguments)]
#[allow(clippy::type_complexity)]
async fn get_directory_contents_for_library(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    library_id: i64,
    _library_root: &str,
    relative_path: &str,
    _absolute_path: &str,
    count: i64,
    offset: i64,
    sort: Option<&str>,
    sort_dir: Option<&str>,
    filter: Option<&str>,
    folders_only: bool,
    files_only: bool,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
) -> FerrotuneApiResult<(Vec<DirectoryChildPaged>, DirectoryStats)> {
    // Path prefix for finding files in this directory
    // file_path in DB is relative to library root, so we use relative_path
    let path_prefix = if relative_path.is_empty() {
        // At library root - match all files (any path)
        String::new()
    } else {
        // In a subdirectory - match files that start with this path
        format!("{}/", relative_path)
    };

    // Get all songs that start with this path prefix and belong to this library
    let all_songs: Vec<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<String>,
        Option<i32>,
        i64,
        String,
        i64,
        Option<i32>,
        String,
        String,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        r#"
        SELECT 
            s.id,
            s.file_path,
            s.title,
            s.album_id,
            al.name as album_name,
            s.year,
            s.genre,
            s.track_number,
            s.file_size,
            s.file_format,
            s.duration,
            s.bitrate,
            s.artist_id,
            ar.name as artist_name,
            s.created_at
        FROM songs s
        LEFT JOIN artists ar ON s.artist_id = ar.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.music_folder_id = ? AND s.file_path LIKE ? || '%'
        ORDER BY s.file_path
        "#,
    )
    .bind(library_id)
    .bind(&path_prefix)
    .fetch_all(pool)
    .await?;

    // Separate into direct children and subdirectories
    let mut direct_songs: Vec<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<String>,
        Option<i32>,
        i64,
        String,
        i64,
        Option<i32>,
        String,
        String,
        chrono::DateTime<chrono::Utc>,
    )> = Vec::new();
    let mut subdir_stats: HashMap<String, (i64, i64)> = HashMap::new(); // (file_count, total_size)

    for song in all_songs {
        let file_path = &song.1;
        let rel_to_current = file_path.strip_prefix(&path_prefix).unwrap_or(file_path);

        if rel_to_current.contains('/') {
            // This song is in a subdirectory
            let first_component = rel_to_current.split('/').next().unwrap().to_string();
            let entry = subdir_stats.entry(first_component).or_insert((0, 0));
            entry.0 += 1; // file count
            entry.1 += song.8; // total size
        } else {
            // This song is directly in this folder
            direct_songs.push(song);
        }
    }

    // Build list of all children (folders first, then files)
    let mut all_children: Vec<DirectoryChildPaged> = Vec::new();

    // Add subdirectories with stats
    if !files_only {
        for (subdir_name, (file_count, total_size)) in &subdir_stats {
            // Build relative path for this subdirectory
            let subdir_relative_path = if relative_path.is_empty() {
                subdir_name.clone()
            } else {
                format!("{}/{}", relative_path, subdir_name)
            };

            // Apply filter if provided
            if let Some(filter_text) = filter {
                if !subdir_name
                    .to_lowercase()
                    .contains(&filter_text.to_lowercase())
                {
                    continue;
                }
            }

            all_children.push(DirectoryChildPaged {
                id: subdir_relative_path.clone(),
                parent: Some(relative_path.to_string()),
                is_dir: true,
                title: subdir_name.clone(),
                artist: None,
                artist_id: None,
                album: None,
                album_id: None,
                cover_art: None,
                cover_art_data: None,
                year: None,
                genre: None,
                track: None,
                size: None,
                content_type: None,
                suffix: None,
                duration: None,
                bit_rate: None,
                path: Some(subdir_relative_path),
                starred: None,
                user_rating: None,
                created: None,
                folder_size: Some(*total_size),
                child_count: Some(*file_count),
            });
        }
    }

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = direct_songs.iter().map(|s| s.0.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_size {
        // song_thumbnail_data: (song_id, album_id)
        let song_thumbnail_data: Vec<(String, Option<String>)> = direct_songs
            .iter()
            .map(|s| (s.0.clone(), s.3.clone()))
            .collect();
        get_song_thumbnails_base64(pool, &song_thumbnail_data, size).await
    } else {
        HashMap::new()
    };

    // Add songs
    if !folders_only {
        for song in direct_songs.iter() {
            // Apply filter if provided
            if let Some(filter_text) = filter {
                let filter_lower = filter_text.to_lowercase();
                let matches = song.2.to_lowercase().contains(&filter_lower)
                    || song.13.to_lowercase().contains(&filter_lower)
                    || song
                        .4
                        .as_ref()
                        .map(|a| a.to_lowercase().contains(&filter_lower))
                        .unwrap_or(false);
                if !matches {
                    continue;
                }
            }

            let content_type = get_content_type_for_format(&song.9);

            // file_path in the database is already relative to library root
            let song_relative_path = song.1.clone();

            all_children.push(DirectoryChildPaged {
                id: song.0.clone(),
                parent: Some(relative_path.to_string()),
                is_dir: false,
                title: song.2.clone(),
                artist: Some(song.13.clone()),
                artist_id: Some(song.12.clone()),
                album: song.4.clone(),
                album_id: song.3.clone(),
                cover_art: Some(song.0.clone()), // Use song ID for cover art
                cover_art_data: thumbnails.get(&song.0).cloned(),
                year: song.5,
                genre: song.6.clone(),
                track: song.7,
                size: Some(song.8),
                content_type: Some(content_type.to_string()),
                suffix: Some(song.9.clone()),
                duration: Some(song.10),
                bit_rate: song.11,
                path: Some(song_relative_path),
                starred: starred_map.get(&song.0).cloned(),
                user_rating: ratings_map.get(&song.0).copied(),
                created: Some(song.14.to_rfc3339()),
                folder_size: None,
                child_count: None,
            });
        }
    }

    // Calculate stats before sorting/pagination
    let folder_count = subdir_stats.len() as i64;
    let file_count = direct_songs.len() as i64;
    let total_count = all_children.len() as i64;
    let total_size: i64 = direct_songs.iter().map(|s| s.8).sum();

    // Sort children
    let sort_field = sort.unwrap_or("name");
    let sort_direction = sort_dir.unwrap_or("asc");
    let ascending = sort_direction == "asc";

    match sort_field {
        "name" => all_children.sort_by(|a, b| {
            // Folders first, then by name
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => {
                    let cmp = a.title.to_lowercase().cmp(&b.title.to_lowercase());
                    if ascending {
                        cmp
                    } else {
                        cmp.reverse()
                    }
                }
            }
        }),
        "artist" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => {
                let cmp = a.title.to_lowercase().cmp(&b.title.to_lowercase());
                if ascending {
                    cmp
                } else {
                    cmp.reverse()
                }
            }
            (false, false) => {
                let a_artist = a.artist.as_deref().unwrap_or("");
                let b_artist = b.artist.as_deref().unwrap_or("");
                let cmp = a_artist.to_lowercase().cmp(&b_artist.to_lowercase());
                if ascending {
                    cmp
                } else {
                    cmp.reverse()
                }
            }
        }),
        "album" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => {
                let cmp = a.title.to_lowercase().cmp(&b.title.to_lowercase());
                if ascending {
                    cmp
                } else {
                    cmp.reverse()
                }
            }
            (false, false) => {
                let a_album = a.album.as_deref().unwrap_or("");
                let b_album = b.album.as_deref().unwrap_or("");
                let cmp = a_album.to_lowercase().cmp(&b_album.to_lowercase());
                if ascending {
                    cmp
                } else {
                    cmp.reverse()
                }
            }
        }),
        "year" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let a_year = a.year.unwrap_or(0);
                let b_year = b.year.unwrap_or(0);
                if ascending {
                    a_year.cmp(&b_year)
                } else {
                    b_year.cmp(&a_year)
                }
            }
        }),
        "duration" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let a_dur = a.duration.unwrap_or(0);
                let b_dur = b.duration.unwrap_or(0);
                if ascending {
                    a_dur.cmp(&b_dur)
                } else {
                    b_dur.cmp(&a_dur)
                }
            }
        }),
        "size" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => {
                let a_size = a.folder_size.unwrap_or(0);
                let b_size = b.folder_size.unwrap_or(0);
                if ascending {
                    a_size.cmp(&b_size)
                } else {
                    b_size.cmp(&a_size)
                }
            }
            (false, false) => {
                let a_size = a.size.unwrap_or(0);
                let b_size = b.size.unwrap_or(0);
                if ascending {
                    a_size.cmp(&b_size)
                } else {
                    b_size.cmp(&a_size)
                }
            }
        }),
        "dateAdded" => all_children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let a_created = a.created.as_deref().unwrap_or("");
                let b_created = b.created.as_deref().unwrap_or("");
                let cmp = a_created.cmp(b_created);
                if ascending {
                    cmp
                } else {
                    cmp.reverse()
                }
            }
        }),
        _ => {}
    }

    // Apply pagination
    let start = offset as usize;
    let paginated: Vec<DirectoryChildPaged> = all_children
        .into_iter()
        .skip(start)
        .take(count as usize)
        .collect();

    Ok((
        paginated,
        DirectoryStats {
            total_count,
            folder_count,
            file_count,
            total_size,
        },
    ))
}
