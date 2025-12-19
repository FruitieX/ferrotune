use crate::api::ScanState;

use crate::error::{Error, Result};
use async_walkdir::WalkDir;
use futures_lite::StreamExt;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use sqlx::SqlitePool;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

/// Size threshold for partial hashing. Files smaller than this use the entire file.
const PARTIAL_HASH_CHUNK_SIZE: u64 = 64 * 1024; // 64KB

/// Compute a partial hash of a file for fast duplicate detection.
///
/// For files >= 128KB: hash(first 64KB + last 64KB + file_size)
/// For smaller files: hash the entire file content + file_size
///
/// Returns the hash as a hex string.
fn compute_partial_hash(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let file_size = file.metadata()?.len();

    let mut hasher = blake3::Hasher::new();

    // Include file size in hash to differentiate files with same content at boundaries
    hasher.update(&file_size.to_le_bytes());

    if file_size <= PARTIAL_HASH_CHUNK_SIZE * 2 {
        // Small file: hash entire content
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)?;
        hasher.update(&buffer);
    } else {
        // Large file: hash first 64KB + last 64KB
        let mut buffer = vec![0u8; PARTIAL_HASH_CHUNK_SIZE as usize];

        // Read first 64KB
        file.read_exact(&mut buffer)?;
        hasher.update(&buffer);

        // Read last 64KB
        file.seek(SeekFrom::End(-(PARTIAL_HASH_CHUNK_SIZE as i64)))?;
        file.read_exact(&mut buffer)?;
        hasher.update(&buffer);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

/// Compute a full file hash using BLAKE3.
/// Returns the hash as a hex string.
fn compute_full_hash(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();

    // Read in 64KB chunks for efficiency
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

pub async fn scan_library(
    pool: &SqlitePool,
    full: bool,
    folder_id: Option<i64>,
    dry_run: bool,
) -> Result<()> {
    scan_library_with_progress(pool, full, folder_id, dry_run, None).await
}

/// Scan specific files rather than walking entire directories.
///
/// This is optimized for the file watcher use case where we know exactly
/// which files have changed. Skips directory enumeration and only processes
/// the provided file paths.
pub async fn scan_specific_files(
    pool: &SqlitePool,
    folder_id: i64,
    file_paths: Vec<PathBuf>,
) -> Result<()> {
    if file_paths.is_empty() {
        return Ok(());
    }

    // Get the folder info
    let folder = get_music_folder(pool, folder_id).await?;
    let base_path = PathBuf::from(&folder.path);

    tracing::info!(
        "Scanning {} specific file(s) in folder {}",
        file_paths.len(),
        folder.name
    );

    let supported_extensions = ["mp3", "flac", "ogg", "opus", "m4a", "mp4", "aac", "wav"];
    let mut added = 0;
    let mut updated = 0;
    let mut removed = 0;
    let mut errors = 0;

    for path in file_paths {
        // Check if file extension is supported
        let is_audio = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| supported_extensions.contains(&ext.to_lowercase().as_str()))
            .unwrap_or(false);

        if !is_audio {
            continue;
        }

        // Get relative path from base
        let relative_path = path
            .strip_prefix(&base_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.exists() {
            // File exists or was modified - extract and upsert
            let file_mtime = std::fs::metadata(&path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);

            match extract_metadata(pool, &path, file_mtime).await {
                Ok(metadata) => {
                    match upsert_song(pool, metadata, relative_path.clone(), folder_id).await {
                        Ok(is_new) => {
                            if is_new {
                                added += 1;
                                tracing::info!("Added: {}", relative_path);
                            } else {
                                updated += 1;
                                tracing::debug!("Updated: {}", relative_path);
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                "Failed to save song metadata for {}: {}",
                                relative_path,
                                e
                            );
                            errors += 1;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("Failed to extract metadata from {}: {}", path.display(), e);
                    errors += 1;
                }
            }
        } else {
            // File was deleted - remove from database
            let result =
                sqlx::query("DELETE FROM songs WHERE file_path = ? AND music_folder_id = ?")
                    .bind(&relative_path)
                    .bind(folder_id)
                    .execute(pool)
                    .await?;

            if result.rows_affected() > 0 {
                removed += 1;
                tracing::info!("Removed: {}", relative_path);
            }
        }
    }

    tracing::info!(
        "Specific file scan complete: {} added, {} updated, {} removed, {} errors",
        added,
        updated,
        removed,
        errors
    );

    Ok(())
}

/// Scan the music library with optional progress tracking.
///
/// This is the main entry point for async scanning with progress updates.
/// If `scan_state` is provided, progress will be broadcast via the shared state.
///
/// The scan proceeds in two phases:
/// 1. **Enumeration Phase**: Walk all folders and collect file paths. This ensures
///    the total count is known before scanning starts.
/// 2. **Scanning Phase**: Process the collected files, extracting metadata and
///    updating the database.
pub async fn scan_library_with_progress(
    pool: &SqlitePool,
    full: bool,
    folder_id: Option<i64>,
    dry_run: bool,
    scan_state: Option<Arc<ScanState>>,
) -> Result<()> {
    let supported_extensions = ["mp3", "flac", "ogg", "opus", "m4a", "mp4", "aac", "wav"];

    // Get music folders from database (database is the source of truth)
    let folders = if let Some(id) = folder_id {
        vec![get_music_folder(pool, id).await?]
    } else {
        crate::db::queries::get_music_folders(pool).await?
    };

    // ==========================================
    // PHASE 1: Enumerate all files from all folders
    // ==========================================
    if let Some(ref state) = scan_state {
        state.log("INFO", "Starting enumeration phase...").await;
        state.broadcast().await;
    }
    tracing::info!("Starting enumeration phase for {} folders", folders.len());

    // Collect all files to scan: (folder_id, base_path, absolute_path)
    let mut files_to_scan: Vec<(i64, PathBuf, PathBuf)> = Vec::new();

    for folder in &folders {
        // Check for cancellation
        if let Some(ref state) = scan_state {
            if state.is_cancelled() {
                state.log("WARN", "Scan cancelled by user").await;
                return Err(Error::InvalidRequest("Scan cancelled".to_string()));
            }
            state.set_current_folder(Some(folder.name.clone())).await;
            state
                .log(
                    "INFO",
                    format!("Enumerating folder: {} ({})", folder.name, folder.path),
                )
                .await;
            state.broadcast().await;
        }

        let base_path = PathBuf::from(&folder.path);

        // Safety check: verify the directory exists and is readable
        if !base_path.exists() {
            let error_msg = format!(
                "Music folder '{}' does not exist. Is the volume mounted?",
                folder.path
            );
            tracing::error!("{}", error_msg);
            if let Some(ref state) = scan_state {
                state.log("ERROR", &error_msg).await;
            }
            // Update folder with error
            if !dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    pool, folder.id, &error_msg,
                )
                .await;
            }
            continue; // Skip this folder but continue with others
        }

        if !base_path.is_dir() {
            let error_msg = format!("Music folder path '{}' is not a directory", folder.path);
            tracing::error!("{}", error_msg);
            if let Some(ref state) = scan_state {
                state.log("ERROR", &error_msg).await;
            }
            if !dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    pool, folder.id, &error_msg,
                )
                .await;
            }
            continue;
        }

        // Try to read the directory to verify we have permission
        if std::fs::read_dir(&base_path).is_err() {
            let error_msg = format!(
                "Cannot read music folder '{}'. Check permissions or volume mount.",
                folder.path
            );
            tracing::error!("{}", error_msg);
            if let Some(ref state) = scan_state {
                state.log("ERROR", &error_msg).await;
            }
            if !dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    pool, folder.id, &error_msg,
                )
                .await;
            }
            continue;
        }

        // Walk the directory and collect file paths
        let mut folder_file_count = 0u64;
        let mut entries = WalkDir::new(&base_path);
        while let Some(entry) = entries.next().await {
            // Check for cancellation during enumeration
            if let Some(ref state) = scan_state {
                if state.is_cancelled() {
                    state.log("WARN", "Scan cancelled by user").await;
                    return Err(Error::InvalidRequest("Scan cancelled".to_string()));
                }
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();

            // Skip directories
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !file_type.is_file() {
                continue;
            }

            if let Some(ext) = path.extension() {
                if supported_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                    files_to_scan.push((folder.id, base_path.clone(), path));
                    folder_file_count += 1;

                    // Broadcast progress every 100 files
                    if let Some(ref state) = scan_state {
                        if folder_file_count.is_multiple_of(100) {
                            state.add_to_total(100).await;
                            state
                                .log(
                                    "INFO",
                                    format!(
                                        "Enumerating folder: {}... ({} found)",
                                        folder.name, folder_file_count
                                    ),
                                )
                                .await;
                            state.broadcast().await;
                        }
                    }
                }
            }
        }

        // Add remaining count for this folder
        if let Some(ref state) = scan_state {
            let remainder = folder_file_count % 100;
            if remainder > 0 {
                state.add_to_total(remainder).await;
            }
            state
                .log(
                    "INFO",
                    format!("Found {} audio files in {}", folder_file_count, folder.name),
                )
                .await;
            state.broadcast().await;
        }
        tracing::info!(
            "Enumerated {} files in folder: {}",
            folder_file_count,
            folder.name
        );
    }

    let total_files = files_to_scan.len();
    if let Some(ref state) = scan_state {
        state
            .log(
                "INFO",
                format!("Enumeration complete. {} total files to scan.", total_files),
            )
            .await;
        state.broadcast().await;
    }
    tracing::info!("Enumeration complete: {} total files", total_files);

    // ==========================================
    // PHASE 2: Scan the collected files
    // ==========================================
    if let Some(ref state) = scan_state {
        state.log("INFO", "Starting scan phase...").await;
        state.broadcast().await;
    }

    // Group files by folder for efficient processing
    let mut files_by_folder: std::collections::HashMap<i64, Vec<(PathBuf, PathBuf)>> =
        std::collections::HashMap::new();
    for (folder_id, base_path, file_path) in files_to_scan {
        files_by_folder
            .entry(folder_id)
            .or_default()
            .push((base_path, file_path));
    }

    // Process each folder
    for folder in &folders {
        let Some(files) = files_by_folder.get(&folder.id) else {
            continue; // No files for this folder (maybe it errored during enumeration)
        };

        if let Some(ref state) = scan_state {
            state.set_current_folder(Some(folder.name.clone())).await;
            state
                .log(
                    "INFO",
                    format!("Scanning folder: {} ({} files)", folder.name, files.len()),
                )
                .await;
            state.broadcast().await;
        }

        let folder_result = scan_folder_files(
            pool,
            folder.id,
            &folder.path,
            files,
            full,
            dry_run,
            scan_state.clone(),
        )
        .await;

        // Update folder scan timestamp/error based on result
        if !dry_run {
            match &folder_result {
                Ok(()) => {
                    // Update last_scanned_at timestamp on success
                    if let Err(e) =
                        crate::api::ferrotune::music_folders::update_folder_scan_timestamp(
                            pool, folder.id,
                        )
                        .await
                    {
                        tracing::warn!("Failed to update folder scan timestamp: {}", e);
                    }
                }
                Err(e) => {
                    // Store error message on failure
                    let error_msg = e.to_string();
                    if let Err(update_err) =
                        crate::api::ferrotune::music_folders::update_folder_scan_error(
                            pool, folder.id, &error_msg,
                        )
                        .await
                    {
                        tracing::warn!("Failed to update folder scan error: {}", update_err);
                    }
                }
            }
        }

        // Propagate the error if the folder scan failed
        folder_result?;
    }

    // After scanning all folders, detect and resolve hash collisions
    if !dry_run {
        if let Some(ref state) = scan_state {
            state.log("INFO", "Detecting duplicates...").await;
        }
        let duplicate_count = detect_duplicates(pool, folder_id, scan_state.clone()).await?;
        if let Some(ref state) = scan_state {
            if duplicate_count > 0 {
                state
                    .log("WARN", format!("Found {} duplicate files", duplicate_count))
                    .await;
            }
        }

        // Cleanup orphaned thumbnails
        if let Some(ref state) = scan_state {
            state.log("INFO", "Cleaning up thumbnails...").await;
        }

        // Remove thumbnails that are no longer referenced by any song, album, or artist
        // Use a single DELETE with LEFT JOINs which is more efficient than triple NOT IN subqueries
        let orphan_result = sqlx::query(
            "DELETE FROM cover_art_thumbnails 
             WHERE hash NOT IN (
                 SELECT cover_art_hash FROM songs WHERE cover_art_hash IS NOT NULL
                 UNION
                 SELECT cover_art_hash FROM albums WHERE cover_art_hash IS NOT NULL
                 UNION  
                 SELECT cover_art_hash FROM artists WHERE cover_art_hash IS NOT NULL
             )",
        )
        .execute(pool)
        .await?;

        let orphaned_thumbnails = orphan_result.rows_affected();
        if orphaned_thumbnails > 0 {
            tracing::info!("Removed {} orphaned thumbnails", orphaned_thumbnails);
        }
    } else {
        // In dry-run mode, just report potential duplicates
        detect_duplicates_dry_run(pool, folder_id).await?;
    }

    Ok(())
}

async fn get_music_folder(pool: &SqlitePool, id: i64) -> Result<crate::db::models::MusicFolder> {
    sqlx::query_as::<_, crate::db::models::MusicFolder>(
        "SELECT * FROM music_folders WHERE id = ? AND enabled = 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| Error::NotFound(format!("Music folder with id {} not found", id)))
}

/// Scan a folder using pre-collected file paths.
///
/// This function is called by scan_library_with_progress after the enumeration phase
/// has collected all file paths. The files parameter contains tuples of (base_path, file_path)
/// where file_path is the absolute path to the file.
async fn scan_folder_files(
    pool: &SqlitePool,
    folder_id: i64,
    folder_path: &str,
    files: &[(PathBuf, PathBuf)],
    full: bool,
    dry_run: bool,
    scan_state: Option<Arc<ScanState>>,
) -> Result<()> {
    let base_path = PathBuf::from(folder_path);

    let mut scanned = 0;
    let mut added = 0;
    let mut updated = 0;
    let mut unchanged = 0;
    let mut errors = 0;

    // Load all existing file paths for this folder from database.
    // We'll track which ones we see during the scan - any remaining are missing files.
    tracing::info!("Loading existing songs from database...");
    if let Some(ref state) = scan_state {
        state
            .log("INFO", "Loading existing songs from database...")
            .await;
    }

    let existing_paths: Vec<(String, String)> =
        sqlx::query_as("SELECT id, file_path FROM songs WHERE music_folder_id = ?")
            .bind(folder_id)
            .fetch_all(pool)
            .await?;

    let mut unseen_files: std::collections::HashMap<String, String> = existing_paths
        .into_iter()
        .map(|(id, path)| (path, id))
        .collect();

    tracing::info!(
        "Found {} existing songs, processing {} files...",
        unseen_files.len(),
        files.len()
    );
    if let Some(ref state) = scan_state {
        state
            .log(
                "INFO",
                format!(
                    "Found {} existing songs, processing {} files...",
                    unseen_files.len(),
                    files.len()
                ),
            )
            .await;
    }

    // Process each file from the pre-collected list
    for (_, path) in files {
        // Check for cancellation
        if let Some(ref state) = scan_state {
            if state.is_cancelled() {
                state.log("WARN", "Scan cancelled by user").await;
                return Err(Error::InvalidRequest("Scan cancelled".to_string()));
            }
        }

        scanned += 1;

        // Update progress
        if let Some(ref state) = scan_state {
            state.increment_scanned();
            state
                .set_current_file(Some(
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                ))
                .await;
            // Throttled broadcast (sends at most every 200ms)
            state.broadcast_throttled().await;
        }

        // Get relative path from base
        let relative_path = path
            .strip_prefix(&base_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // Mark this file as seen (remove from unseen set)
        let existing_id = unseen_files.remove(&relative_path);

        // Get file modification time (used for incremental scanning)
        let file_mtime = std::fs::metadata(path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        // Check if file already exists in database (use cached info if available)
        let existing: Option<(String, Option<i64>)> = if let Some(id) = existing_id {
            // We know it exists, fetch mtime for incremental scan check
            sqlx::query_as("SELECT id, file_mtime FROM songs WHERE id = ?")
                .bind(&id)
                .fetch_optional(pool)
                .await?
        } else {
            None
        };

        if !full {
            if let Some((_, stored_mtime)) = &existing {
                // Skip if file hasn't been modified since last scan
                if file_mtime.is_some() && stored_mtime == &file_mtime {
                    unchanged += 1;
                    if let Some(ref state) = scan_state {
                        state.track_unchanged(&path.to_string_lossy()).await;
                    }
                    if scanned % 100 == 0 {
                        tracing::info!(
                            "Progress: {} files scanned, {} added, {} updated, {} unchanged, {} errors",
                            scanned,
                            added,
                            updated,
                            unchanged,
                            errors
                        );
                        if let Some(ref state) = scan_state {
                            state
                                .log(
                                    "INFO",
                                    format!(
                                        "Progress: {} files scanned, {} added, {} updated, {} unchanged, {} errors",
                                        scanned, added, updated, unchanged, errors
                                    ),
                                )
                                .await;
                        }
                    }
                    continue;
                }
            }
        }

        // In dry-run mode, just count what would be added/updated
        if dry_run {
            if existing.is_none() {
                tracing::info!("Would add: {}", relative_path);
                if let Some(ref state) = scan_state {
                    state.track_added(&path.to_string_lossy()).await;
                }
                added += 1;
            } else {
                tracing::info!("Would update: {}", relative_path);
                if let Some(ref state) = scan_state {
                    state.track_updated(&path.to_string_lossy()).await;
                }
                updated += 1;
            }
            continue;
        }

        // Extract metadata (pass file_mtime to avoid re-reading it)
        match extract_metadata(pool, path, file_mtime).await {
            Ok(metadata) => {
                match upsert_song(pool, metadata, relative_path.clone(), folder_id).await {
                    Ok(is_new) => {
                        if is_new {
                            added += 1;
                            if let Some(ref state) = scan_state {
                                state.track_added(&path.to_string_lossy()).await;
                            }
                        } else {
                            updated += 1;
                            if let Some(ref state) = scan_state {
                                state.track_updated(&path.to_string_lossy()).await;
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to save song metadata: {}", e);
                        if let Some(ref state) = scan_state {
                            state
                                .track_error(&path.to_string_lossy(), &e.to_string())
                                .await;
                            state
                                .log("ERROR", format!("Failed to save metadata: {}", e))
                                .await;
                        }
                        errors += 1;
                    }
                }
            }
            Err(e) => {
                tracing::debug!("Failed to extract metadata from {}: {}", path.display(), e);
                if let Some(ref state) = scan_state {
                    state
                        .track_error(&path.to_string_lossy(), &e.to_string())
                        .await;
                }
                errors += 1;
            }
        }

        if scanned % 100 == 0 {
            tracing::info!(
                "Progress: {} files scanned, {} added, {} updated, {} unchanged, {} errors",
                scanned,
                added,
                updated,
                unchanged,
                errors
            );
            if let Some(ref state) = scan_state {
                state
                    .log(
                        "INFO",
                        format!(
                            "Progress: {} files scanned, {} added, {} updated, {} unchanged, {} errors",
                            scanned, added, updated, unchanged, errors
                        ),
                    )
                    .await;
            }
        }
    }

    // Any files still in unseen_files no longer exist on disk - remove them
    let removed =
        remove_missing_songs(pool, &unseen_files, &base_path, dry_run, scan_state.clone()).await?;

    if let Some(ref state) = scan_state {
        state.set_current_file(None).await;
        state.broadcast().await;
    }

    if !dry_run {
        tracing::info!(
            "Folder scan complete: {} files scanned, {} added, {} updated, {} unchanged, {} removed, {} errors",
            scanned,
            added,
            updated,
            unchanged,
            removed,
            errors
        );
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    format!(
                        "Folder scan complete: {} files scanned, {} added, {} updated, {} unchanged, {} removed, {} errors",
                        scanned, added, updated, unchanged, removed, errors
                    ),
                )
                .await;
        }
    } else {
        tracing::info!(
            "Dry-run complete: {} files scanned, {} would be added, {} would be updated, {} unchanged, {} would be removed, {} errors",
            scanned,
            added,
            updated,
            unchanged,
            removed,
            errors
        );
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    format!(
                        "Dry-run complete: {} files scanned, {} would be added, {} would be updated, {} unchanged, {} would be removed, {} errors",
                        scanned, added, updated, unchanged, removed, errors
                    ),
                )
                .await;
        }
    }

    Ok(())
}

/// Remove songs from database that no longer exist on disk.
/// Takes a map of file_path -> song_id for files that were not seen during scan.
///
/// This function also detects renamed files by comparing partial_hash values.
/// If a "missing" file has the same hash as a "new" file, it's treated as a rename:
/// - The old entry's file_path is updated to the new path
/// - The new entry (created during scanning) is deleted
/// - This preserves play counts, starred status, and other metadata
async fn remove_missing_songs(
    pool: &SqlitePool,
    missing_files: &std::collections::HashMap<String, String>,
    base_path: &Path,
    dry_run: bool,
    scan_state: Option<Arc<crate::api::ScanState>>,
) -> Result<usize> {
    if missing_files.is_empty() {
        return Ok(0);
    }

    // Collect IDs and paths for missing files
    let missing_ids: Vec<&String> = missing_files.values().collect();

    // Get partial hashes for missing files
    let missing_hashes: Vec<(String, String, Option<String>)> = {
        let mut hashes = Vec::new();
        for id in &missing_ids {
            if let Ok(Some(row)) = sqlx::query_as::<_, (String, String, Option<String>)>(
                "SELECT id, file_path, partial_hash FROM songs WHERE id = ?",
            )
            .bind(id)
            .fetch_optional(pool)
            .await
            {
                hashes.push(row);
            }
        }
        hashes
    };

    // Track which files are renames vs truly removed
    let mut renamed_ids: Vec<String> = Vec::new();
    let mut renamed_count = 0;

    // For each missing file with a hash, check if there's a newly added file with the same hash
    for (missing_id, old_path, hash_opt) in &missing_hashes {
        if let Some(hash) = hash_opt {
            // Look for a different song with the same partial_hash in this folder
            // that has a different file_path (i.e., a newly added file)
            let potential_rename: Option<(String, String)> = sqlx::query_as(
                "SELECT id, file_path FROM songs 
                 WHERE partial_hash = ? AND id != ? AND music_folder_id = (
                     SELECT music_folder_id FROM songs WHERE id = ?
                 )",
            )
            .bind(hash)
            .bind(missing_id)
            .bind(missing_id)
            .fetch_optional(pool)
            .await?;

            if let Some((new_id, new_path)) = potential_rename {
                // Found a rename! Update the old entry with the new path and delete the new entry
                if dry_run {
                    let full_old_path = base_path.join(old_path).to_string_lossy().to_string();
                    let full_new_path = base_path.join(&new_path).to_string_lossy().to_string();
                    tracing::info!(
                        "Would detect rename: {} -> {}",
                        full_old_path,
                        full_new_path
                    );
                    if let Some(ref state) = scan_state {
                        state.track_renamed(&full_old_path, &full_new_path).await;
                    }
                } else {
                    // Start a transaction for the rename
                    let mut tx = pool.begin().await?;

                    // Copy the new file_path and mtime to the old entry
                    sqlx::query(
                        "UPDATE songs SET 
                            file_path = ?,
                            file_mtime = (SELECT file_mtime FROM songs WHERE id = ?),
                            updated_at = datetime('now')
                         WHERE id = ?",
                    )
                    .bind(&new_path)
                    .bind(&new_id)
                    .bind(missing_id)
                    .execute(&mut *tx)
                    .await?;

                    // Delete the newly created entry (duplicated by the scan)
                    sqlx::query("DELETE FROM songs WHERE id = ?")
                        .bind(&new_id)
                        .execute(&mut *tx)
                        .await?;

                    tx.commit().await?;

                    let full_old_path = base_path.join(old_path).to_string_lossy().to_string();
                    let full_new_path = base_path.join(&new_path).to_string_lossy().to_string();
                    tracing::info!("Detected rename: {} -> {}", full_old_path, full_new_path);
                    if let Some(ref state) = scan_state {
                        state.track_renamed(&full_old_path, &full_new_path).await;
                    }
                }
                renamed_ids.push(missing_id.clone());
                renamed_count += 1;
            }
        }
    }

    // Filter out renamed files from the removal list
    let truly_missing: std::collections::HashMap<String, String> = missing_files
        .iter()
        .filter(|(_, id)| !renamed_ids.contains(id))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    if truly_missing.is_empty() {
        return Ok(renamed_count);
    }

    let count = truly_missing.len();
    let relative_paths: Vec<String> = truly_missing.keys().cloned().collect();

    for file_path in &relative_paths {
        tracing::info!("Missing file: {}", file_path);
    }

    // Track removed files in scan state (using full paths for display)
    if let Some(ref state) = scan_state {
        let full_paths: Vec<String> = relative_paths
            .iter()
            .map(|p| base_path.join(p).to_string_lossy().to_string())
            .collect();
        state.track_removed(&full_paths).await;
    }

    if dry_run {
        tracing::info!(
            "Dry-run: would remove {} missing files from database",
            count
        );
        return Ok(count + renamed_count);
    }

    // Delete missing songs in a transaction
    let mut tx = pool.begin().await?;

    // First, convert all playlist entries for these songs to "missing" entries
    // This preserves the song metadata so entries can be re-matched later
    for id in truly_missing.values() {
        // Get song metadata before deleting
        let song_meta: Option<(String, Option<String>, Option<String>, i64)> = sqlx::query_as(
            "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             WHERE s.id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some((title, artist_name, album_name, duration)) = song_meta {
            // Build the missing entry data JSON
            let missing_data = serde_json::json!({
                "title": title,
                "artist": artist_name,
                "album": album_name,
                "duration": duration as i32,
                "raw": format!("{} - {}", artist_name.as_deref().unwrap_or("Unknown Artist"), title)
            });
            let missing_json = serde_json::to_string(&missing_data).unwrap_or_default();

            // Build search text: "artist - album - title" for filtering
            let mut parts = Vec::new();
            if let Some(ref a) = &artist_name {
                parts.push(a.as_str());
            }
            if let Some(ref al) = &album_name {
                parts.push(al.as_str());
            }
            parts.push(title.as_str());
            let search_text = parts.join(" - ");

            // Convert playlist entries to "missing" entries
            sqlx::query(
                "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = ?, missing_search_text = ? WHERE song_id = ?"
            )
            .bind(&missing_json)
            .bind(&search_text)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }

        // Delete the song
        sqlx::query("DELETE FROM songs WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    // Update affected playlist totals
    sqlx::query(
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = playlists.id),
            updated_at = datetime('now')"
    )
    .execute(&mut *tx)
    .await?;

    // Clean up orphaned albums (no songs reference them)
    let orphaned_albums = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)"
    )
    .fetch_one(&mut *tx)
    .await?;

    if orphaned_albums > 0 {
        sqlx::query(
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)"
        )
        .execute(&mut *tx)
        .await?;
        tracing::info!("Removed {} orphaned albums", orphaned_albums);
    }

    // Clean up orphaned artists (no songs or albums reference them)
    let orphaned_artists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
         AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
    )
    .fetch_one(&mut *tx)
    .await?;

    if orphaned_artists > 0 {
        sqlx::query(
            "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
             AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
        )
        .execute(&mut *tx)
        .await?;
        tracing::info!("Removed {} orphaned artists", orphaned_artists);
    }

    // Update album song counts and durations for remaining albums
    sqlx::query(
        "UPDATE albums SET 
            song_count = (SELECT COUNT(*) FROM songs WHERE songs.album_id = albums.id),
            duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE songs.album_id = albums.id)"
    )
    .execute(&mut *tx)
    .await?;

    // Update artist album counts for remaining artists
    sqlx::query(
        "UPDATE artists SET 
            album_count = (SELECT COUNT(DISTINCT album_id) FROM songs WHERE songs.artist_id = artists.id AND album_id IS NOT NULL)"
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(
        "Removed {} missing files from database, {} renamed",
        count,
        renamed_count
    );

    Ok(count + renamed_count)
}

#[derive(Debug)]
struct SongMetadata {
    title: String,
    artist: String,
    album: Option<String>,
    album_artist: Option<String>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    year: Option<i32>,
    genre: Option<String>,
    duration: u64,
    bitrate: Option<u32>,
    file_size: u64,
    file_format: String,
    file_mtime: Option<i64>,
    partial_hash: Option<String>,
    cover_art_hash: Option<String>,
}

async fn extract_metadata(
    pool: &SqlitePool,
    path: &Path,
    file_mtime: Option<i64>,
) -> Result<SongMetadata> {
    let tagged_file = Probe::open(path)
        .map_err(Error::Lofty)?
        .read()
        .map_err(Error::Lofty)?;

    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let file_size = std::fs::metadata(path)?.len();
    let file_format = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    let duration = properties.duration().as_secs();
    let bitrate = properties.audio_bitrate();

    // Extract cover art and generate thumbnails if needed
    let cover_art_hash = {
        let full_path = path.to_path_buf();
        // Try to extract cover art (external first, then embedded)
        // We use block_in_place or spawn_blocking if we needed heavy lifting,
        // but here we just call async functions that do I/O
        match crate::thumbnails::find_external_cover_art(&full_path).await {
            Ok(data) => crate::thumbnails::ensure_cover_art(pool, &data).await.ok(),
            Err(_) => match crate::thumbnails::extract_embedded_cover_art(&full_path).await {
                Ok(data) => crate::thumbnails::ensure_cover_art(pool, &data).await.ok(),
                Err(_) => None,
            },
        }
    };

    // Compute partial hash for duplicate detection
    let partial_hash = match compute_partial_hash(path) {
        Ok(hash) => Some(hash),
        Err(e) => {
            tracing::warn!(
                "Failed to compute partial hash for {}: {}",
                path.display(),
                e
            );
            None
        }
    };

    // Extract tags
    let (title, artist, album, album_artist, track_number, disc_number, year, genre) =
        if let Some(tag) = tag {
            let title = tag.title().map(|s| s.to_string()).unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string()
            });

            let artist = tag
                .artist()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Artist".to_string());

            let album = tag.album().map(|s| s.to_string());

            let album_artist = tag
                .get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string());

            let track_number = tag.track().or_else(|| {
                tag.get_string(&lofty::tag::ItemKey::TrackNumber)
                    .and_then(|s| s.parse().ok())
            });

            let disc_number = tag.disk().or_else(|| {
                tag.get_string(&lofty::tag::ItemKey::DiscNumber)
                    .and_then(|s| s.parse().ok())
            });

            let year = tag.year().map(|y| y as i32).or_else(|| {
                tag.get_string(&lofty::tag::ItemKey::Year)
                    .and_then(|s| s.parse::<i32>().ok())
            });

            let genre = tag.genre().map(|s| s.to_string());

            (
                title,
                artist,
                album,
                album_artist,
                track_number,
                disc_number,
                year,
                genre,
            )
        } else {
            // No tags found, use filename
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();

            (
                title,
                "Unknown Artist".to_string(),
                None,
                None,
                None,
                None,
                None,
                None,
            )
        };

    Ok(SongMetadata {
        title,
        artist,
        album,
        album_artist,
        track_number,
        disc_number: disc_number.or(Some(1)),
        year,
        genre,
        duration,
        bitrate,
        file_size,
        file_format,
        file_mtime,
        partial_hash,
        cover_art_hash,
    })
}

async fn upsert_song(
    pool: &SqlitePool,
    metadata: SongMetadata,
    file_path: String,
    folder_id: i64,
) -> Result<bool> {
    // Start a transaction
    let mut tx = pool.begin().await?;

    // Get or create album artist (for the album)
    // Use album_artist tag if present, otherwise fall back to track artist
    let album_artist_name = metadata.album_artist.as_ref().unwrap_or(&metadata.artist);
    let album_artist_id = get_or_create_artist(&mut tx, album_artist_name).await?;

    // Get or create track artist (for the song)
    // This is the actual performer of this specific track
    let track_artist_id = get_or_create_artist(&mut tx, &metadata.artist).await?;

    // Get or create album if present
    let album_id = if let Some(album_name) = &metadata.album {
        Some(
            get_or_create_album(
                &mut tx,
                album_name,
                &album_artist_id,
                album_artist_name,
                metadata.year,
                metadata.genre.as_deref(),
                metadata.cover_art_hash.as_deref(), // Use first song's art as album art
            )
            .await?,
        )
    } else {
        None
    };

    // Check if song exists
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM songs WHERE file_path = ?")
        .bind(&file_path)
        .fetch_optional(&mut *tx)
        .await?;

    let is_new = existing.is_none();
    let _song_id = if let Some((id,)) = existing {
        // Update existing song
        // Note: we clear full_file_hash since the file content may have changed
        sqlx::query(
            "UPDATE songs SET 
                title = ?, album_id = ?, artist_id = ?, track_number = ?, 
                disc_number = ?, year = ?, genre = ?, duration = ?, 
                bitrate = ?, file_size = ?, file_format = ?, music_folder_id = ?,
                file_mtime = ?, partial_hash = ?, cover_art_hash = ?, full_file_hash = NULL, updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(&metadata.title)
        .bind(&album_id)
        .bind(&track_artist_id)
        .bind(metadata.track_number.map(|n| n as i32))
        .bind(metadata.disc_number.map(|n| n as i32).unwrap_or(1))
        .bind(metadata.year)
        .bind(&metadata.genre)
        .bind(metadata.duration as i64)
        .bind(metadata.bitrate.map(|b| b as i32))
        .bind(metadata.file_size as i64)
        .bind(&metadata.file_format)
        .bind(folder_id)
        .bind(metadata.file_mtime)
        .bind(&metadata.partial_hash)
        .bind(&metadata.cover_art_hash)
        .bind(&id)
        .execute(&mut *tx)
        .await?;

        id
    } else {
        // Insert new song
        let song_id = format!("so-{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO songs (
                id, title, album_id, artist_id, track_number, disc_number,
                year, genre, duration, bitrate, file_path, file_size, 
                file_format, music_folder_id, file_mtime, partial_hash, cover_art_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        )
        .bind(&song_id)
        .bind(&metadata.title)
        .bind(&album_id)
        .bind(&track_artist_id)
        .bind(metadata.track_number.map(|n| n as i32))
        .bind(metadata.disc_number.map(|n| n as i32).unwrap_or(1))
        .bind(metadata.year)
        .bind(&metadata.genre)
        .bind(metadata.duration as i64)
        .bind(metadata.bitrate.map(|b| b as i32))
        .bind(&file_path)
        .bind(metadata.file_size as i64)
        .bind(&metadata.file_format)
        .bind(folder_id)
        .bind(metadata.file_mtime)
        .bind(&metadata.partial_hash)
        .bind(&metadata.cover_art_hash)
        .execute(&mut *tx)
        .await?;

        song_id
    };

    // Update album song count and duration
    if let Some(album_id) = &album_id {
        sqlx::query(
            "UPDATE albums SET 
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = ?),
                duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = ?)
             WHERE id = ?",
        )
        .bind(album_id)
        .bind(album_id)
        .bind(album_id)
        .execute(&mut *tx)
        .await?;
    }

    // Update album artist's album count
    sqlx::query(
        "UPDATE artists SET 
            album_count = (SELECT COUNT(*) FROM albums WHERE artist_id = ?)
         WHERE id = ?",
    )
    .bind(&album_artist_id)
    .bind(&album_artist_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(is_new)
}

async fn get_or_create_artist(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    name: &str,
) -> Result<String> {
    // Try to find existing artist
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM artists WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some((id,)) = existing {
        Ok(id)
    } else {
        // Create new artist
        let artist_id = format!("ar-{}", Uuid::new_v4());

        sqlx::query("INSERT INTO artists (id, name, album_count) VALUES (?, ?, 0)")
            .bind(&artist_id)
            .bind(name)
            .execute(&mut **tx)
            .await?;

        Ok(artist_id)
    }
    // If this artist doesn't have a cover art set, but the song/album has one, update it
    // Note: We're not passing cover art genericly to get_or_create_artist yet as it's typically song/album specific
    // But we could implement a logic to pick the "best" cover art for the artist later
}

async fn get_or_create_album(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    name: &str,
    artist_id: &str,
    _artist_name: &str,
    year: Option<i32>,
    genre: Option<&str>,
    cover_art_hash: Option<&str>,
) -> Result<String> {
    // Try to find existing album by name and artist
    let existing: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, cover_art_hash FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?",
    )
    .bind(name)
    .bind(artist_id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some((id, existing_hash)) = existing {
        // Update metadata if changed (e.g. year found in later tracks)
        // Also set cover_art_hash if it was missing
        if existing_hash.is_none() && cover_art_hash.is_some() {
            sqlx::query("UPDATE albums SET cover_art_hash = ? WHERE id = ?")
                .bind(cover_art_hash)
                .bind(&id)
                .execute(&mut **tx)
                .await?;
        }

        // Simple year update logic could go here
        return Ok(id);
    }

    // Create new album
    let id = format!("al-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO albums (id, name, artist_id, year, genre, created_at, cover_art_hash) 
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(artist_id)
    .bind(year)
    .bind(genre)
    .bind(cover_art_hash)
    .execute(&mut **tx)
    .await?;

    Ok(id)
}

/// Detect duplicate files by finding partial hash collisions and computing full hashes.
///
/// Phase 1: Find all songs with duplicate partial_hash values
/// Phase 2: For each collision group, compute full file hashes
/// Phase 3: Update full_file_hash in database and log duplicates
///
/// Returns the total number of duplicate files found.
async fn detect_duplicates(
    pool: &SqlitePool,
    _folder_id: Option<i64>,
    scan_state: Option<Arc<ScanState>>,
) -> Result<u64> {
    // Note: We no longer clear full_file_hash here. Instead, full_file_hash is cleared
    // in upsert_song when a file is modified, so cached hashes for unchanged files are preserved.

    // Find partial hash collisions (songs with the same partial_hash)
    let collision_hashes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT partial_hash, COUNT(*) as cnt 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
    )
    .fetch_all(pool)
    .await?;

    if collision_hashes.is_empty() {
        tracing::info!("No potential duplicates found (no partial hash collisions)");
        if let Some(ref state) = scan_state {
            state.log("INFO", "No duplicate files found").await;
        }
        return Ok(0);
    }

    tracing::info!(
        "Found {} partial hash collision groups, computing full hashes...",
        collision_hashes.len()
    );

    let mut total_duplicates = 0;

    // For each collision group, compute full hashes
    for (partial_hash, _count) in collision_hashes {
        // Get all songs with this partial hash, including cached full_file_hash if present
        let songs: Vec<(String, String, i64, i64, Option<String>)> = sqlx::query_as(
            "SELECT s.id, s.file_path, s.music_folder_id, s.file_size, s.full_file_hash
             FROM songs s
             WHERE s.partial_hash = ?",
        )
        .bind(&partial_hash)
        .fetch_all(pool)
        .await?;

        // Get music folders to resolve full paths
        let folders = crate::db::queries::get_music_folders(pool).await?;
        let folder_map: std::collections::HashMap<i64, String> =
            folders.into_iter().map(|f| (f.id, f.path)).collect();

        // Compute full hash for each song in the collision group
        let mut hash_to_songs: std::collections::HashMap<String, Vec<(String, String, i64)>> =
            std::collections::HashMap::new();

        for (song_id, file_path, music_folder_id, file_size, cached_full_hash) in songs {
            // Use cached full_file_hash if available (file hasn't changed since last scan)
            let full_hash = if let Some(cached) = cached_full_hash {
                cached
            } else {
                let base_path = match folder_map.get(&music_folder_id) {
                    Some(p) => p,
                    None => {
                        tracing::warn!(
                            "Unknown music folder {} for song {}",
                            music_folder_id,
                            song_id
                        );
                        continue;
                    }
                };

                let full_path = PathBuf::from(base_path).join(&file_path);

                // For small files (where partial = full), use partial_hash as full_hash
                let computed_hash = if file_size as u64 <= PARTIAL_HASH_CHUNK_SIZE * 2 {
                    partial_hash.clone()
                } else {
                    match compute_full_hash(&full_path) {
                        Ok(h) => h,
                        Err(e) => {
                            tracing::warn!(
                                "Failed to compute full hash for {}: {}",
                                full_path.display(),
                                e
                            );
                            continue;
                        }
                    }
                };
                computed_hash
            };

            hash_to_songs
                .entry(full_hash)
                .or_default()
                .push((song_id, file_path, file_size));
        }

        // Update full_file_hash for songs that are actually duplicates
        for (full_hash, songs_with_hash) in hash_to_songs {
            if songs_with_hash.len() > 1 {
                // These are actual duplicates
                total_duplicates += songs_with_hash.len();

                tracing::warn!(
                    "Found {} duplicate files with hash {}:",
                    songs_with_hash.len(),
                    &full_hash[..16] // First 16 chars for readability
                );

                // Collect paths for tracking
                let mut duplicate_paths: Vec<String> = Vec::new();

                for (song_id, file_path, file_size) in &songs_with_hash {
                    tracing::warn!("  - {} ({} bytes)", file_path, file_size);
                    duplicate_paths.push(file_path.clone());

                    // Update the full_file_hash in database
                    sqlx::query("UPDATE songs SET full_file_hash = ? WHERE id = ?")
                        .bind(&full_hash)
                        .bind(song_id)
                        .execute(pool)
                        .await?;
                }

                // Track duplicates in scan state
                if let Some(ref state) = scan_state {
                    state.track_duplicates(&duplicate_paths).await;
                }
            }
            // If only one song has this full hash, it was a false positive from partial hash
            // collision, so we don't set full_file_hash
        }
    }

    if total_duplicates > 0 {
        tracing::warn!(
            "Duplicate detection complete: {} files are duplicates",
            total_duplicates
        );
    } else {
        tracing::info!("Duplicate detection complete: no actual duplicates found (partial hash collisions were false positives)");
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    "No actual duplicate files found (false positives resolved)",
                )
                .await;
        }
    }

    Ok(total_duplicates as u64)
}

/// Dry-run version of duplicate detection - just reports what would be found.
async fn detect_duplicates_dry_run(pool: &SqlitePool, _folder_id: Option<i64>) -> Result<()> {
    // Find partial hash collisions
    let collision_hashes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT partial_hash, COUNT(*) as cnt 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
    )
    .fetch_all(pool)
    .await?;

    if collision_hashes.is_empty() {
        tracing::info!("Dry-run: No potential duplicates found");
        return Ok(());
    }

    tracing::info!(
        "Dry-run: Found {} partial hash collision groups (potential duplicates)",
        collision_hashes.len()
    );

    // Show details for each collision group
    for (partial_hash, count) in &collision_hashes {
        let songs: Vec<(String, String, i64)> =
            sqlx::query_as("SELECT id, file_path, file_size FROM songs WHERE partial_hash = ?")
                .bind(partial_hash)
                .fetch_all(pool)
                .await?;

        tracing::info!(
            "Dry-run: {} files share partial hash {}:",
            count,
            &partial_hash[..16]
        );
        for (_, file_path, file_size) in &songs {
            tracing::info!("  - {} ({} bytes)", file_path, file_size);
        }
    }

    Ok(())
}
