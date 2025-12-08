//! Paginated directory browsing endpoint for the Ferrotune API.
//!
//! This provides an enhanced directory browser with pagination, sorting,
//! filtering, and folder size information.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{get_ratings_map, get_starred_map};
use crate::api::AppState;
use axum::extract::{Query, State};
use axum::response::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

/// Parameters for paginated directory listing
#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetDirectoryPagedParams {
    /// Directory ID (dir-<path> format) or empty for root
    pub id: Option<String>,
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
}

/// Paginated directory response
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryPagedResponse {
    pub id: String,
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
    /// Breadcrumb path from root
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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetDirectoryPagedParams>,
) -> crate::error::Result<Json<DirectoryPagedResponse>> {
    let count = params.count.unwrap_or(100).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    // Determine the path from the ID
    let path = if let Some(ref id) = params.id {
        if let Some(p) = id.strip_prefix("dir-") {
            urlencoding::decode(p)
                .map_err(|_| {
                    crate::error::Error::InvalidRequest("Invalid path encoding".to_string())
                })?
                .into_owned()
        } else {
            // Not a dir- ID, return empty
            String::new()
        }
    } else {
        String::new()
    };

    // Build breadcrumbs
    let breadcrumbs = build_breadcrumbs(&path);

    // Get parent ID
    let parent = if path.is_empty() {
        None
    } else {
        std::path::Path::new(&path)
            .parent()
            .and_then(|p| p.to_str())
            .filter(|s| !s.is_empty())
            .map(|p| format!("dir-{}", urlencoding::encode(p)))
    };

    // Get directory name
    let name = if path.is_empty() {
        "Root".to_string()
    } else {
        std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path)
            .to_string()
    };

    // Get directory contents with stats
    let (children, stats) = get_directory_contents_paged(
        &state.pool,
        user.user_id,
        &path,
        count,
        offset,
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
        params.filter.as_deref(),
        params.folders_only.unwrap_or(false),
        params.files_only.unwrap_or(false),
    )
    .await?;

    let current_id = if path.is_empty() {
        "dir-".to_string()
    } else {
        format!("dir-{}", urlencoding::encode(&path))
    };

    let response = DirectoryPagedResponse {
        id: current_id,
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

/// Build breadcrumb path from root to current directory
fn build_breadcrumbs(path: &str) -> Vec<BreadcrumbItem> {
    if path.is_empty() {
        return vec![];
    }

    let mut breadcrumbs = vec![BreadcrumbItem {
        id: "dir-".to_string(),
        name: "Root".to_string(),
    }];

    let mut current_path = String::new();
    for component in path.split('/') {
        if component.is_empty() {
            continue;
        }
        if current_path.is_empty() {
            current_path = component.to_string();
        } else {
            current_path = format!("{}/{}", current_path, component);
        }
        breadcrumbs.push(BreadcrumbItem {
            id: format!("dir-{}", urlencoding::encode(&current_path)),
            name: component.to_string(),
        });
    }

    breadcrumbs
}

/// Get paginated directory contents with sorting and filtering
async fn get_directory_contents_paged(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    path: &str,
    count: i64,
    offset: i64,
    sort: Option<&str>,
    sort_dir: Option<&str>,
    filter: Option<&str>,
    folders_only: bool,
    files_only: bool,
) -> crate::error::Result<(Vec<DirectoryChildPaged>, DirectoryStats)> {
    // Normalize path
    let path = path.trim_end_matches('/');
    let path_prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{}/", path)
    };

    // Get all songs that start with this path prefix
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
        WHERE s.file_path LIKE ? || '%'
        ORDER BY s.file_path
        "#,
    )
    .bind(&path_prefix)
    .fetch_all(pool)
    .await?;

    // Separate into direct children and subdirectories, calculating folder stats
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
        let relative_path = file_path.strip_prefix(&path_prefix).unwrap_or(file_path);

        if relative_path.contains('/') {
            // This song is in a subdirectory
            let first_component = relative_path.split('/').next().unwrap().to_string();
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
            let full_path = if path.is_empty() {
                subdir_name.clone()
            } else {
                format!("{}/{}", path, subdir_name)
            };

            all_children.push(DirectoryChildPaged {
                id: format!("dir-{}", urlencoding::encode(&full_path)),
                parent: Some(if path.is_empty() {
                    "dir-".to_string()
                } else {
                    format!("dir-{}", urlencoding::encode(path))
                }),
                is_dir: true,
                title: subdir_name.clone(),
                artist: None,
                artist_id: None,
                album: None,
                album_id: None,
                cover_art: None,
                year: None,
                genre: None,
                track: None,
                size: None,
                content_type: None,
                suffix: None,
                duration: None,
                bit_rate: None,
                path: Some(full_path),
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
    let starred_map = get_starred_map(pool, user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, "song", &song_ids).await?;

    // Add songs
    if !folders_only {
        for song in direct_songs.iter() {
            let content_type = match song.9.as_str() {
                "mp3" => "audio/mpeg",
                "flac" => "audio/flac",
                "ogg" | "opus" => "audio/ogg",
                "m4a" | "mp4" | "aac" => "audio/mp4",
                "wav" => "audio/wav",
                _ => "application/octet-stream",
            };

            all_children.push(DirectoryChildPaged {
                id: song.0.clone(),
                parent: Some(if path.is_empty() {
                    "dir-".to_string()
                } else {
                    format!("dir-{}", urlencoding::encode(path))
                }),
                is_dir: false,
                title: song.2.clone(),
                artist: Some(song.13.clone()),
                artist_id: Some(song.12.clone()),
                album: song.4.clone(),
                album_id: song.3.clone(),
                cover_art: song.3.clone().or_else(|| Some(song.0.clone())),
                year: song.5,
                genre: song.6.clone(),
                track: song.7,
                size: Some(song.8),
                content_type: Some(content_type.to_string()),
                suffix: Some(song.9.clone()),
                duration: Some(song.10),
                bit_rate: song.11,
                path: Some(song.1.clone()),
                starred: starred_map.get(&song.0).cloned(),
                user_rating: ratings_map.get(&song.0).copied(),
                created: Some(song.14.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
                folder_size: None,
                child_count: None,
            });
        }
    }

    // Apply filter
    if let Some(filter_text) = filter {
        let filter_lower = filter_text.to_lowercase();
        all_children.retain(|child| {
            child.title.to_lowercase().contains(&filter_lower)
                || child
                    .artist
                    .as_ref()
                    .map_or(false, |a| a.to_lowercase().contains(&filter_lower))
                || child
                    .album
                    .as_ref()
                    .map_or(false, |a| a.to_lowercase().contains(&filter_lower))
        });
    }

    // Calculate stats before pagination
    let folder_count = all_children.iter().filter(|c| c.is_dir).count() as i64;
    let file_count = all_children.iter().filter(|c| !c.is_dir).count() as i64;
    let total_size: i64 = all_children
        .iter()
        .filter_map(|c| if c.is_dir { c.folder_size } else { c.size })
        .sum();
    let total_count = all_children.len() as i64;

    // Apply sorting
    let dir = match sort_dir {
        Some("desc") => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Less,
    };

    all_children.sort_by(|a, b| {
        // Folders always come first
        if a.is_dir != b.is_dir {
            return if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        let cmp = match sort {
            Some("artist") => a
                .artist
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b.artist.as_deref().unwrap_or("").to_lowercase()),
            Some("album") => a
                .album
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b.album.as_deref().unwrap_or("").to_lowercase()),
            Some("year") => a.year.cmp(&b.year),
            Some("duration") => a.duration.cmp(&b.duration),
            Some("size") => {
                let a_size = if a.is_dir {
                    a.folder_size.unwrap_or(0)
                } else {
                    a.size.unwrap_or(0)
                };
                let b_size = if b.is_dir {
                    b.folder_size.unwrap_or(0)
                } else {
                    b.size.unwrap_or(0)
                };
                a_size.cmp(&b_size)
            }
            Some("dateAdded") => a.created.cmp(&b.created),
            _ => a.title.to_lowercase().cmp(&b.title.to_lowercase()), // default: name
        };

        if dir == std::cmp::Ordering::Greater {
            cmp.reverse()
        } else {
            cmp
        }
    });

    // Apply pagination
    let paginated: Vec<DirectoryChildPaged> = all_children
        .into_iter()
        .skip(offset as usize)
        .take(count as usize)
        .collect();

    let stats = DirectoryStats {
        total_count,
        folder_count,
        file_count,
        total_size,
    };

    Ok((paginated, stats))
}
