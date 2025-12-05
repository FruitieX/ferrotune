//! Duplicate file detection API endpoint.

use crate::api::AppState;
use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// A group of duplicate files sharing the same content hash.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DuplicateGroup {
    /// The full content hash shared by all files in this group.
    pub hash: String,
    /// Number of duplicate files.
    pub count: i64,
    /// Total size of duplicates (count - 1) * file_size (wasted space).
    pub wasted_bytes: i64,
    /// The duplicate files.
    pub files: Vec<DuplicateFile>,
}

/// Information about a duplicate file.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DuplicateFile {
    /// Song ID.
    pub id: String,
    /// File path relative to music folder.
    pub file_path: String,
    /// File size in bytes.
    pub file_size: i64,
    /// Song title.
    pub title: String,
    /// Artist name.
    pub artist: Option<String>,
    /// Album name.
    pub album: Option<String>,
    /// Music folder name.
    pub folder: String,
}

/// Response from the duplicates endpoint.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DuplicatesResponse {
    /// Total number of duplicate groups.
    pub group_count: usize,
    /// Total number of duplicate files.
    pub total_duplicates: i64,
    /// Total wasted space in bytes.
    pub total_wasted_bytes: i64,
    /// The duplicate groups.
    pub groups: Vec<DuplicateGroup>,
}

/// Get all duplicate files detected during scanning.
///
/// Returns groups of files that have identical content (same full file hash).
/// Only files that were detected as duplicates during a scan will appear here.
///
/// ## Response
///
/// ```json
/// {
///   "groupCount": 2,
///   "totalDuplicates": 6,
///   "totalWastedBytes": 52428800,
///   "groups": [
///     {
///       "hash": "abc123...",
///       "count": 3,
///       "wastedBytes": 20971520,
///       "files": [
///         {
///           "id": "so-xxx",
///           "filePath": "Artist/Album/track.mp3",
///           "fileSize": 10485760,
///           "title": "Track Name",
///           "artist": "Artist Name",
///           "album": "Album Name",
///           "folder": "Music"
///         }
///       ]
///     }
///   ]
/// }
/// ```
pub async fn get_duplicates(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Query for all songs with non-null full_file_hash, grouped by hash
    let rows: Vec<(
        String,
        String,
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
        String,
    )> = match sqlx::query_as(
        "SELECT 
                s.full_file_hash,
                s.id,
                s.file_path,
                s.file_size,
                s.title,
                ar.name as artist_name,
                al.name as album_name,
                mf.name as folder_name
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             WHERE s.full_file_hash IS NOT NULL
             ORDER BY s.full_file_hash, s.file_path",
    )
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to query duplicates: {}", e);
            return Json(DuplicatesResponse {
                group_count: 0,
                total_duplicates: 0,
                total_wasted_bytes: 0,
                groups: vec![],
            });
        }
    };

    // Group by hash
    let mut groups: std::collections::HashMap<String, Vec<DuplicateFile>> =
        std::collections::HashMap::new();
    let mut file_sizes: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

    for (hash, id, file_path, file_size, title, artist, album, folder) in rows {
        file_sizes.entry(hash.clone()).or_insert(file_size);
        groups.entry(hash).or_default().push(DuplicateFile {
            id,
            file_path,
            file_size,
            title,
            artist,
            album,
            folder,
        });
    }

    // Convert to response format
    let mut duplicate_groups: Vec<DuplicateGroup> = groups
        .into_iter()
        .map(|(hash, files)| {
            let count = files.len() as i64;
            let file_size = file_sizes.get(&hash).copied().unwrap_or(0);
            // Wasted space = (count - 1) * file_size (keeping one, rest are wasted)
            let wasted_bytes = (count - 1) * file_size;

            DuplicateGroup {
                hash,
                count,
                wasted_bytes,
                files,
            }
        })
        .collect();

    // Sort by wasted space descending (most impactful first)
    duplicate_groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));

    let group_count = duplicate_groups.len();
    let total_duplicates: i64 = duplicate_groups.iter().map(|g| g.count).sum();
    let total_wasted_bytes: i64 = duplicate_groups.iter().map(|g| g.wasted_bytes).sum();

    Json(DuplicatesResponse {
        group_count,
        total_duplicates,
        total_wasted_bytes,
        groups: duplicate_groups,
    })
}
