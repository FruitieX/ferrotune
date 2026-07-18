//! Paginated directory browsing endpoint for the Ferrotune API.
//!
//! This provides an enhanced directory browser with pagination, sorting,
//! filtering, and folder size information.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::get_content_type_for_format;
use crate::api::inline_thumbnails::{get_song_thumbnails_base64, InlineImagesParam};
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
    let folders =
        crate::db::repo::users::get_music_folders_for_user(&state.database, user.user_id).await?;

    let mut libraries = Vec::new();
    for folder in folders {
        // Get stats for this folder
        let stats =
            crate::db::repo::browse::get_music_folder_song_stats(&state.database, folder.id)
                .await?;

        libraries.push(LibraryInfo {
            id: folder.id,
            name: folder.name,
            song_count: stats.file_count,
            total_size: stats.total_size,
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
    let requested_count = params.count.unwrap_or(100);
    if requested_count == 0 || requested_count > 500 {
        return Err(Error::InvalidRequest("count must be between 1 and 500".to_string()).into());
    }
    let count = requested_count as i64;
    let offset = params.offset.unwrap_or(0) as i64;
    let inline_size = params.inline_images.get_size();

    // Library ID is required
    let library_id = params
        .library_id
        .ok_or_else(|| Error::InvalidRequest("libraryId is required".to_string()))?;

    let has_access =
        crate::api::users::user_has_folder_access(&state.database, user.user_id, library_id)
            .await?;
    if !has_access {
        return Err(Error::Forbidden("Access denied to library".to_string()).into());
    }

    // Get the music folder
    let folder = crate::db::repo::browse::get_enabled_music_folder(&state.database, library_id)
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
        &state.database,
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
    database: &crate::db::Database,
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
    use crate::db::repo::browse::{
        DirectoryFolderPage, DirectoryPageOptions, DirectorySongPage, DirectorySort,
    };

    if folders_only && files_only {
        return Err(Error::InvalidRequest(
            "foldersOnly and filesOnly cannot both be true".to_string(),
        )
        .into());
    }
    let sort = match sort.unwrap_or("name") {
        "name" => DirectorySort::Name,
        "artist" => DirectorySort::Artist,
        "album" => DirectorySort::Album,
        "year" => DirectorySort::Year,
        "duration" => DirectorySort::Duration,
        "size" => DirectorySort::Size,
        "dateAdded" => DirectorySort::DateAdded,
        value => {
            return Err(
                Error::InvalidRequest(format!("unsupported directory sort field: {value}")).into(),
            )
        }
    };
    let descending = match sort_dir.unwrap_or("asc") {
        "asc" => false,
        "desc" => true,
        value => {
            return Err(Error::InvalidRequest(format!(
                "unsupported directory sort direction: {value}"
            ))
            .into())
        }
    };
    let path_prefix = if relative_path.is_empty() {
        String::new()
    } else {
        format!("{relative_path}/")
    };
    let offset = u64::try_from(offset)
        .map_err(|_| Error::InvalidRequest("offset cannot be negative".to_string()))?;
    let count = u64::try_from(count)
        .map_err(|_| Error::InvalidRequest("count cannot be negative".to_string()))?;

    let folder_page = if files_only {
        DirectoryFolderPage {
            rows: Vec::new(),
            total: 0,
        }
    } else {
        crate::db::repo::browse::page_directory_folders(
            database,
            library_id,
            &path_prefix,
            DirectoryPageOptions {
                filter,
                sort,
                descending,
                offset,
                limit: count,
            },
        )
        .await?
    };
    let remaining = count.saturating_sub(folder_page.rows.len() as u64);
    let song_offset = if files_only {
        offset
    } else {
        offset.saturating_sub(folder_page.total.max(0) as u64)
    };
    let song_page = if folders_only {
        DirectorySongPage {
            rows: Vec::new(),
            total: 0,
            total_size: 0,
        }
    } else {
        crate::db::repo::browse::page_directory_songs(
            database,
            library_id,
            &path_prefix,
            DirectoryPageOptions {
                filter,
                sort,
                descending,
                offset: song_offset,
                limit: remaining,
            },
        )
        .await?
    };

    let song_ids: Vec<String> = song_page.rows.iter().map(|song| song.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;
    let thumbnails = if let Some(size) = inline_size {
        let thumbnail_data = song_page
            .rows
            .iter()
            .map(|song| (song.id.clone(), song.album_id.clone()))
            .collect::<Vec<_>>();
        get_song_thumbnails_base64(database, &thumbnail_data, size).await
    } else {
        HashMap::new()
    };

    let mut children = Vec::with_capacity(folder_page.rows.len() + song_page.rows.len());
    for folder in &folder_page.rows {
        let folder_path = if relative_path.is_empty() {
            folder.name.clone()
        } else {
            format!("{relative_path}/{}", folder.name)
        };
        children.push(DirectoryChildPaged {
            id: folder_path.clone(),
            parent: Some(relative_path.to_string()),
            is_dir: true,
            title: folder.name.clone(),
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
            path: Some(folder_path),
            starred: None,
            user_rating: None,
            created: None,
            folder_size: Some(folder.total_size),
            child_count: Some(folder.file_count),
        });
    }
    for song in &song_page.rows {
        children.push(DirectoryChildPaged {
            id: song.id.clone(),
            parent: Some(relative_path.to_string()),
            is_dir: false,
            title: song.title.clone(),
            artist: Some(song.artist_name.clone()),
            artist_id: Some(song.artist_id.clone()),
            album: song.album_name.clone(),
            album_id: song.album_id.clone(),
            cover_art: Some(song.id.clone()),
            cover_art_data: thumbnails.get(&song.id).cloned(),
            year: song.year,
            genre: song.genre.clone(),
            track: song.track_number,
            size: Some(song.file_size),
            content_type: Some(get_content_type_for_format(&song.file_format).to_string()),
            suffix: Some(song.file_format.clone()),
            duration: Some(song.duration),
            bit_rate: song.bitrate,
            path: Some(song.file_path.clone()),
            starred: starred_map.get(&song.id).cloned(),
            user_rating: ratings_map.get(&song.id).copied(),
            created: Some(song.created_at.to_rfc3339()),
            folder_size: None,
            child_count: None,
        });
    }

    Ok((
        children,
        DirectoryStats {
            total_count: folder_page.total + song_page.total,
            folder_count: folder_page.total,
            file_count: song_page.total,
            total_size: song_page.total_size,
        },
    ))
}
