use crate::api::ScanState;
use crate::db::Database;
use crate::error::{Error, Result};
use async_walkdir::WalkDir;
use futures::stream::{self, StreamExt};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use sea_orm::{FromQueryResult, TransactionTrait, Value};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;
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

/// Parse a ReplayGain value string into a floating point dB value.
///
/// ReplayGain tags can be in various formats:
/// - "-6.50 dB" (with unit)
/// - "-6.50" (without unit)
/// - "+3.20 dB" (with plus sign)
///
/// Returns None if the string cannot be parsed.
fn parse_replaygain_value(s: &str) -> Option<f64> {
    // Remove " dB" suffix if present, and trim whitespace
    let value_str = s
        .trim()
        .trim_end_matches(" dB")
        .trim_end_matches("dB")
        .trim();
    value_str.parse::<f64>().ok()
}

/// Format a duration in seconds as a human-readable ETA string.
fn format_eta(total_secs: u64) -> String {
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    if hours > 0 {
        format!("{}h {}m {}s", hours, minutes, seconds)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds)
    } else {
        format!("{}s", seconds)
    }
}

fn clone_runtime_database(database: &crate::db::Database) -> Result<Database> {
    Ok(database.clone())
}

pub async fn scan_library(
    database: &crate::db::Database,
    full: bool,
    folder_id: Option<i64>,
    dry_run: bool,
    analyze_replaygain: bool,
) -> Result<()> {
    scan_library_with_progress(
        database,
        ScanOptions {
            full,
            folder_id,
            dry_run,
            analyze_replaygain,
            analyze_bliss: false,
            analyze_waveform: false,
            skip: None,
        },
        None,
    )
    .await
}

/// Scan specific files rather than walking entire directories.
/// This is optimized for the file watcher use case where we know exactly
/// which files have changed. Skips directory enumeration and only processes
/// the provided file paths.
///
/// Note: ReplayGain analysis is not performed on file watcher scans to avoid
/// high CPU usage during normal operation. Users can run a full scan with
/// ReplayGain analysis enabled to compute gain values.
pub async fn scan_specific_files(
    database: &crate::db::Database,
    folder_id: i64,
    file_paths: Vec<PathBuf>,
) -> Result<()> {
    if file_paths.is_empty() {
        return Ok(());
    }

    // Get the folder info
    let folder = get_music_folder(database, folder_id).await?;
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
    let mut first_error_message: Option<String> = None;

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

            // No analysis in watcher mode, but semaphore is still required by the API
            let no_analysis_semaphore = Semaphore::new(1);
            match extract_metadata(
                database,
                &path,
                file_mtime,
                false,
                false,
                false,
                &no_analysis_semaphore,
            )
            .await
            {
                Ok(metadata) => {
                    match upsert_song(database, metadata, relative_path.clone(), folder_id).await {
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
                            if first_error_message.is_none() {
                                first_error_message = Some(format!(
                                    "Failed to save song metadata for {}: {}",
                                    relative_path, e
                                ));
                            }
                            errors += 1;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("Failed to extract metadata from {}: {}", path.display(), e);
                    if first_error_message.is_none() {
                        first_error_message = Some(format!(
                            "Failed to extract metadata from {}: {}",
                            path.display(),
                            e
                        ));
                    }
                    errors += 1;
                }
            }
        } else {
            // File was deleted - remove from database
            let rows_affected = crate::db::raw::execute(
                database.conn(),
                "DELETE FROM songs WHERE file_path = ? AND music_folder_id = ?",
                "DELETE FROM songs WHERE file_path = $1 AND music_folder_id = $2",
                [Value::from(relative_path.clone()), Value::from(folder_id)],
            )
            .await?
            .rows_affected();

            if rows_affected > 0 {
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

    if errors > 0 && added == 0 && updated == 0 && removed == 0 {
        return Err(Error::Internal(first_error_message.unwrap_or_else(|| {
            "Specific file scan failed without a detailed error".to_string()
        })));
    }

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
///
/// If `analyze_replaygain` is true, EBU R128 loudness analysis will be performed
/// on each track to compute ReplayGain values. This is CPU-intensive and significantly
/// increases scan time, as each file must be fully decoded.
/// Options for a library scan.
pub struct ScanOptions {
    pub full: bool,
    pub folder_id: Option<i64>,
    pub dry_run: bool,
    pub analyze_replaygain: bool,
    pub analyze_bliss: bool,
    pub analyze_waveform: bool,
    pub skip: Option<u64>,
}

pub async fn scan_library_with_progress(
    database: &crate::db::Database,
    opts: ScanOptions,
    scan_state: Option<Arc<ScanState>>,
) -> Result<()> {
    let runtime_database = clone_runtime_database(database)?;

    let supported_extensions = ["mp3", "flac", "ogg", "opus", "m4a", "mp4", "aac", "wav"];

    // Get music folders from database (database is the source of truth)
    let folders = if let Some(id) = opts.folder_id {
        vec![get_music_folder(&runtime_database, id).await?]
    } else {
        crate::db::repo::users::get_music_folders(&runtime_database).await?
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
            if !opts.dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    &runtime_database,
                    folder.id,
                    &error_msg,
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
            if !opts.dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    &runtime_database,
                    folder.id,
                    &error_msg,
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
            if !opts.dry_run {
                let _ = crate::api::ferrotune::music_folders::update_folder_scan_error(
                    &runtime_database,
                    folder.id,
                    &error_msg,
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

    // Process each folder and collect missing files info
    let mut all_missing_files: Vec<FolderMissingFiles> = Vec::new();

    for folder in &folders {
        let files: &[(PathBuf, PathBuf)] = files_by_folder
            .get(&folder.id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);

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
            &runtime_database,
            folder.id,
            &folder.path,
            files,
            opts.full,
            opts.dry_run,
            opts.analyze_replaygain,
            opts.analyze_bliss,
            opts.analyze_waveform,
            opts.skip,
            scan_state.clone(),
        )
        .await;

        // Update folder scan timestamp/error based on result
        if !opts.dry_run {
            match &folder_result {
                Ok(_) => {
                    // Update last_scanned_at timestamp on success
                    if let Err(e) =
                        crate::api::ferrotune::music_folders::update_folder_scan_timestamp(
                            &runtime_database,
                            folder.id,
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
                            &runtime_database,
                            folder.id,
                            &error_msg,
                        )
                        .await
                    {
                        tracing::warn!("Failed to update folder scan error: {}", update_err);
                    }
                }
            }
        }

        // Collect missing files info and propagate error if scan failed
        let missing_files = folder_result?;
        if !missing_files.missing_files.is_empty() {
            all_missing_files.push(missing_files);
        }
    }

    // After scanning ALL folders, resolve missing files (detect cross-library renames + delete truly missing)
    if !all_missing_files.is_empty() {
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    "Resolving missing files and detecting cross-library moves...",
                )
                .await;
            state.broadcast().await;
        }
        resolve_missing_songs(
            &runtime_database,
            all_missing_files,
            opts.dry_run,
            scan_state.clone(),
        )
        .await?;
    }

    // After scanning all folders, detect and resolve hash collisions
    if !opts.dry_run {
        if let Some(ref state) = scan_state {
            state.log("INFO", "Detecting duplicates...").await;
        }
        let duplicate_count =
            detect_duplicates(&runtime_database, opts.folder_id, scan_state.clone()).await?;
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
        let orphaned_thumbnails = crate::db::raw::execute(
            runtime_database.conn(),
            "DELETE FROM cover_art_thumbnails 
             WHERE hash NOT IN (
                 SELECT cover_art_hash FROM songs WHERE cover_art_hash IS NOT NULL
                 UNION
                 SELECT cover_art_hash FROM albums WHERE cover_art_hash IS NOT NULL
                 UNION  
                 SELECT cover_art_hash FROM artists WHERE cover_art_hash IS NOT NULL
             )",
            "DELETE FROM cover_art_thumbnails 
             WHERE hash NOT IN (
                 SELECT cover_art_hash FROM songs WHERE cover_art_hash IS NOT NULL
                 UNION
                 SELECT cover_art_hash FROM albums WHERE cover_art_hash IS NOT NULL
                 UNION  
                 SELECT cover_art_hash FROM artists WHERE cover_art_hash IS NOT NULL
             )",
            std::iter::empty::<Value>(),
        )
        .await?
        .rows_affected();
        if orphaned_thumbnails > 0 {
            tracing::info!("Removed {} orphaned thumbnails", orphaned_thumbnails);
        }
    } else {
        // In dry-run mode, just report potential duplicates
        detect_duplicates_dry_run(&runtime_database, opts.folder_id).await?;
    }

    Ok(())
}

async fn get_music_folder(
    database: &crate::db::Database,
    id: i64,
) -> Result<crate::db::models::MusicFolder> {
    let folder = crate::db::raw::query_one::<crate::db::models::MusicFolder>(
        database.conn(),
        "SELECT * FROM music_folders WHERE id = ? AND enabled = 1",
        "SELECT * FROM music_folders WHERE id = $1 AND enabled",
        [Value::from(id)],
    )
    .await?;

    folder.ok_or_else(|| Error::NotFound(format!("Music folder with id {} not found", id)))
}

/// Info about missing files from a scanned folder, used for cross-library rename detection.
#[derive(Debug)]
struct FolderMissingFiles {
    folder_id: i64,
    folder_path: PathBuf,
    /// Map of relative file_path -> song_id for files not found during scan
    missing_files: std::collections::HashMap<String, String>,
}

/// Scan a folder using pre-collected file paths.
///
/// This function is called by scan_library_with_progress after the enumeration phase
/// has collected all file paths. The files parameter contains tuples of (base_path, file_path)
/// where file_path is the absolute path to the file.
///
/// Returns information about files that were in the database but not found on disk.
/// The caller should collect these from all folders and then call resolve_missing_songs
/// to handle renames (including cross-library moves) and deletions.
#[allow(clippy::too_many_arguments)]
async fn scan_folder_files(
    database: &Database,
    folder_id: i64,
    folder_path: &str,
    files: &[(PathBuf, PathBuf)],
    full: bool,
    dry_run: bool,
    analyze_replaygain: bool,
    analyze_bliss: bool,
    analyze_waveform: bool,
    skip: Option<u64>,
    scan_state: Option<Arc<ScanState>>,
) -> Result<FolderMissingFiles> {
    let base_path = PathBuf::from(folder_path);

    let mut scanned = 0u64;
    let mut added = 0u64;
    let mut updated = 0u64;
    let mut unchanged = 0u64;
    let mut errors = 0u64;

    // Load all existing file paths for this folder from database.
    // We'll track which ones we see during the scan - any remaining are missing files.
    // Also fetch mtime and ReplayGain status for incremental scan optimization.
    tracing::info!("Loading existing songs from database...");
    if let Some(ref state) = scan_state {
        state
            .log("INFO", "Loading existing songs from database...")
            .await;
    }

    // Fetch: id, file_path, file_mtime, has_replaygain (1 if computed gain exists, 0 otherwise), has_bliss, has_waveform
    #[derive(FromQueryResult)]
    struct ExistingSongPathRow {
        id: String,
        file_path: String,
        file_mtime: Option<i64>,
        has_rg: i32,
        has_bliss: i32,
        has_waveform: i32,
    }

    let existing_paths = crate::db::raw::query_all::<ExistingSongPathRow>(
        database.conn(),
        "SELECT id, file_path, file_mtime, 
                CASE WHEN computed_replaygain_track_gain IS NOT NULL THEN 1 ELSE 0 END as has_rg,
                CASE WHEN bliss_features IS NOT NULL THEN 1 ELSE 0 END as has_bliss,
                CASE WHEN waveform_data IS NOT NULL THEN 1 ELSE 0 END as has_waveform
         FROM songs WHERE music_folder_id = ?",
        "SELECT id, file_path, file_mtime, 
                CASE WHEN computed_replaygain_track_gain IS NOT NULL THEN 1 ELSE 0 END as has_rg,
                CASE WHEN bliss_features IS NOT NULL THEN 1 ELSE 0 END as has_bliss,
                CASE WHEN waveform_data IS NOT NULL THEN 1 ELSE 0 END as has_waveform
         FROM songs WHERE music_folder_id = $1",
        [Value::from(folder_id)],
    )
    .await?;

    // Map: file_path -> (song_id, file_mtime, has_replaygain, has_bliss, has_waveform)
    let mut unseen_files: std::collections::HashMap<
        String,
        (String, Option<i64>, bool, bool, bool),
    > = existing_paths
        .into_iter()
        .map(|row| {
            (
                row.file_path,
                (
                    row.id,
                    row.file_mtime,
                    row.has_rg != 0,
                    row.has_bliss != 0,
                    row.has_waveform != 0,
                ),
            )
        })
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

    // ==========================================
    // PHASE 1: Classify files (single-threaded)
    // Determine which files to skip vs process, update unseen_files tracking
    // ==========================================

    // Info needed to process a file
    struct FileToProcess {
        path: PathBuf,
        relative_path: String,
        file_mtime: Option<i64>,
    }

    let mut files_to_process: Vec<FileToProcess> = Vec::new();

    for (_, path) in files {
        scanned += 1;

        // Get relative path from base
        let relative_path = path
            .strip_prefix(&base_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // Mark this file as seen (remove from unseen set) and get cached info
        let existing_info = unseen_files.remove(&relative_path);

        // Get file modification time (used for incremental scanning)
        let file_mtime = std::fs::metadata(path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        // Check if we can skip this file in incremental mode
        if !full {
            if let Some((_, stored_mtime, has_replaygain, has_bliss, has_waveform)) = &existing_info
            {
                // Skip if:
                // 1. File hasn't been modified since last scan, AND
                // 2. Either ReplayGain analysis is not requested, OR file already has ReplayGain data
                // 3. Either bliss analysis is not requested, OR file already has bliss data
                // 4. Either waveform analysis is not requested, OR file already has waveform data
                let mtime_unchanged = file_mtime.is_some() && stored_mtime == &file_mtime;
                let replaygain_ok = !analyze_replaygain || *has_replaygain;
                let bliss_ok = !analyze_bliss || *has_bliss;
                let waveform_ok = !analyze_waveform || *has_waveform;

                if mtime_unchanged && replaygain_ok && bliss_ok && waveform_ok {
                    unchanged += 1;
                    if let Some(ref state) = scan_state {
                        state.track_unchanged(&path.to_string_lossy()).await;
                    }
                    continue;
                }
            }
        }

        // In dry-run mode, just count what would be added/updated
        if dry_run {
            if existing_info.is_none() {
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

        // This file needs processing
        files_to_process.push(FileToProcess {
            path: path.clone(),
            relative_path,
            file_mtime,
        });
    }

    // Log classification results
    let files_to_process_count = files_to_process.len();
    tracing::info!(
        "Classification complete: {} files to process, {} unchanged (skipped)",
        files_to_process_count,
        unchanged
    );
    if let Some(ref state) = scan_state {
        state
            .log(
                "INFO",
                format!(
                    "Classification complete: {} files to process, {} unchanged (skipped)",
                    files_to_process_count, unchanged
                ),
            )
            .await;
    }

    // ==========================================
    // PHASE 2: Extract metadata in parallel, write to DB sequentially
    // ==========================================
    //
    // We separate metadata extraction (parallelized) from database writes (sequential)
    // because SQLite concurrent transactions can have race conditions when multiple
    // tasks perform read-modify-write cycles on related records (artists, albums).

    if !files_to_process.is_empty() && !dry_run {
        // Skip files if requested (for debugging — jump to a specific position)
        if let Some(skip_count) = skip {
            let skip_count = skip_count as usize;
            if skip_count > 0 && skip_count < files_to_process.len() {
                tracing::info!(
                    "Skipping first {} files (jumping to file {})",
                    skip_count,
                    skip_count + 1
                );
                if let Some(ref state) = scan_state {
                    state
                        .log(
                            "INFO",
                            format!(
                                "Skipping first {} files (jumping to file {})",
                                skip_count,
                                skip_count + 1
                            ),
                        )
                        .await;
                }
                files_to_process.drain(..skip_count);
            }
        }
        let files_to_process_count = files_to_process.len();

        // Determine concurrency level based on available CPUs
        let concurrency = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);

        // Limit concurrent audio analysis (ReplayGain/bliss) which decode
        // entire audio files into memory as f32 samples. Without a limit, high
        // core counts (e.g. 32) combined with large tracks can cause excessive
        // memory usage and OOM crashes. Overrideable via env var if you have
        // lots of RAM and want to speed up analysis.
        let analysis_concurrency = std::env::var("FERROTUNE_ANALYSIS_CONCURRENCY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or_else(|| concurrency.min(4));
        let analysis_semaphore = Arc::new(Semaphore::new(analysis_concurrency));

        let analysis_label = {
            let mut parts = Vec::new();
            if analyze_replaygain {
                parts.push("ReplayGain");
            }
            if analyze_waveform {
                parts.push("waveform");
            }
            if analyze_bliss {
                parts.push("bliss");
            }
            if parts.is_empty() {
                String::new()
            } else {
                format!(
                    " ({} analysis, {} concurrent)",
                    parts.join(" + "),
                    analysis_concurrency
                )
            }
        };

        tracing::info!(
            "Extracting metadata from {} files with {} parallel workers{}",
            files_to_process_count,
            concurrency,
            analysis_label
        );
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    format!(
                        "Extracting metadata from {} files with {} parallel workers{}",
                        files_to_process_count, concurrency, analysis_label
                    ),
                )
                .await;
        }

        // Atomic counters for parallel tracking
        let extracted_counter = Arc::new(AtomicU64::new(0));
        let extract_errors_counter = Arc::new(AtomicU64::new(0));

        // Wrap cancellation state check in Arc for sharing
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Track extraction start time for ETA estimation
        let extraction_start = std::time::Instant::now();

        // Result type for extracted metadata
        struct ExtractedFile {
            path: PathBuf,
            relative_path: String,
            metadata: SongMetadata,
        }

        // STAGE 1: Extract metadata in parallel
        let extracted_results: Vec<Option<ExtractedFile>> = stream::iter(files_to_process)
            .map(|file_info| {
                let database = database.clone();
                let scan_state = scan_state.clone();
                let extracted_counter = Arc::clone(&extracted_counter);
                let extract_errors_counter = Arc::clone(&extract_errors_counter);
                let cancelled = Arc::clone(&cancelled);
                let analysis_semaphore = Arc::clone(&analysis_semaphore);
                let total_to_process = files_to_process_count;

                async move {
                    // Check for cancellation
                    if cancelled.load(Ordering::Relaxed) {
                        return None;
                    }
                    if let Some(ref state) = scan_state {
                        if state.is_cancelled() {
                            cancelled.store(true, Ordering::Relaxed);
                            return None;
                        }
                    }

                    // Update progress
                    if let Some(ref state) = scan_state {
                        state.increment_scanned();
                        state
                            .set_current_file(Some(
                                file_info
                                    .path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string(),
                            ))
                            .await;
                        state.broadcast_throttled().await;
                    }

                    // Extract metadata (this is the CPU-intensive part, especially with ReplayGain)
                    match extract_metadata(
                        &database,
                        &file_info.path,
                        file_info.file_mtime,
                        analyze_replaygain,
                        analyze_bliss,
                        analyze_waveform,
                        &analysis_semaphore,
                    )
                    .await
                    {
                        Ok(metadata) => {
                            let extracted = extracted_counter.fetch_add(1, Ordering::Relaxed) + 1;
                            if extracted.is_multiple_of(100) || extracted == total_to_process as u64
                            {
                                let eta = {
                                    let elapsed = extraction_start.elapsed().as_secs_f64();
                                    let remaining = total_to_process as u64 - extracted;
                                    let rate = extracted as f64 / elapsed;
                                    if rate > 0.0 {
                                        let secs = (remaining as f64 / rate) as u64;
                                        format_eta(secs)
                                    } else {
                                        "unknown".to_string()
                                    }
                                };
                                tracing::info!(
                                    "Metadata extraction progress: {}/{} (ETA: {})",
                                    extracted,
                                    total_to_process,
                                    eta
                                );
                                if let Some(ref state) = scan_state {
                                    state
                                        .log(
                                            "INFO",
                                            format!(
                                                "Metadata extraction progress: {}/{} (ETA: {})",
                                                extracted, total_to_process, eta
                                            ),
                                        )
                                        .await;
                                }
                            }
                            Some(ExtractedFile {
                                path: file_info.path,
                                relative_path: file_info.relative_path,
                                metadata,
                            })
                        }
                        Err(e) => {
                            tracing::debug!(
                                "Failed to extract metadata from {}: {}",
                                file_info.path.display(),
                                e
                            );
                            if let Some(ref state) = scan_state {
                                state
                                    .track_error(&file_info.path.to_string_lossy(), &e.to_string())
                                    .await;
                            }
                            extract_errors_counter.fetch_add(1, Ordering::Relaxed);
                            None
                        }
                    }
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await;

        // Check if cancelled during extraction — still proceed to write what we have
        let mut was_cancelled = cancelled.load(Ordering::Relaxed);
        if was_cancelled {
            if let Some(ref state) = scan_state {
                state
                    .log(
                        "WARN",
                        "Scan cancelled by user, saving already-extracted metadata...",
                    )
                    .await;
            }
        }

        // Collect successful extractions
        let extracted_files: Vec<ExtractedFile> = extracted_results.into_iter().flatten().collect();
        let extract_errors = extract_errors_counter.load(Ordering::Relaxed);

        tracing::info!(
            "Metadata extraction complete: {} succeeded, {} failed",
            extracted_files.len(),
            extract_errors
        );

        // STAGE 2: Write to database sequentially (to avoid race conditions)
        if !extracted_files.is_empty() {
            tracing::info!("Writing {} songs to database...", extracted_files.len());
            if let Some(ref state) = scan_state {
                state
                    .log(
                        "INFO",
                        format!("Writing {} songs to database...", extracted_files.len()),
                    )
                    .await;
            }

            for (idx, extracted) in extracted_files.into_iter().enumerate() {
                // Check for new cancellation during DB writes (skip if already saving after cancellation)
                if !was_cancelled {
                    if let Some(ref state) = scan_state {
                        if state.is_cancelled() {
                            was_cancelled = true;
                            state
                                .log("WARN", "Scan cancelled, saving progress...")
                                .await;
                            break;
                        }
                    }
                }

                match upsert_song(
                    database,
                    extracted.metadata,
                    extracted.relative_path.clone(),
                    folder_id,
                )
                .await
                {
                    Ok(is_new) => {
                        if is_new {
                            added += 1;
                            if let Some(ref state) = scan_state {
                                state.track_added(&extracted.path.to_string_lossy()).await;
                            }
                        } else {
                            updated += 1;
                            if let Some(ref state) = scan_state {
                                state.track_updated(&extracted.path.to_string_lossy()).await;
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to save song metadata: {}", e);
                        if let Some(ref state) = scan_state {
                            state
                                .track_error(&extracted.path.to_string_lossy(), &e.to_string())
                                .await;
                            state
                                .log("ERROR", format!("Failed to save metadata: {}", e))
                                .await;
                        }
                        errors += 1;
                    }
                }

                // Log progress periodically
                if (idx + 1) % 100 == 0 || idx + 1 == files_to_process_count {
                    tracing::info!(
                        "Database write progress: {}/{}, {} added, {} updated, {} errors",
                        idx + 1,
                        files_to_process_count,
                        added,
                        updated,
                        errors
                    );
                    if let Some(ref state) = scan_state {
                        state
                            .log(
                                "INFO",
                                format!(
                                    "Database write progress: {}/{}, {} added, {} updated, {} errors",
                                    idx + 1, files_to_process_count, added, updated, errors
                                ),
                            )
                            .await;
                    }
                }
            }
        }

        // Add extraction errors to total
        errors += extract_errors;

        // Return cancellation error after saving what we extracted
        if was_cancelled {
            if let Some(ref state) = scan_state {
                state
                    .log(
                        "INFO",
                        format!(
                            "Saved {} songs before cancellation ({} added, {} updated)",
                            added + updated,
                            added,
                            updated
                        ),
                    )
                    .await;
            }
            return Err(Error::InvalidRequest("Scan cancelled".to_string()));
        }
    }

    // Any files still in unseen_files no longer exist on disk
    // Return this info so the caller can handle cross-library rename detection
    // Extract just the song_id from the tuple for missing file tracking
    let missing_count = unseen_files.len();
    let unseen_files: std::collections::HashMap<String, String> = unseen_files
        .into_iter()
        .map(|(path, (id, _, _, _, _))| (path, id))
        .collect();

    if let Some(ref state) = scan_state {
        state.set_current_file(None).await;
        state.broadcast().await;
    }

    if !dry_run {
        tracing::info!(
            "Folder scan complete: {} files scanned, {} added, {} updated, {} unchanged, {} missing, {} errors",
            scanned,
            added,
            updated,
            unchanged,
            missing_count,
            errors
        );
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    format!(
                        "Folder scan complete: {} files scanned, {} added, {} updated, {} unchanged, {} missing, {} errors",
                        scanned, added, updated, unchanged, missing_count, errors
                    ),
                )
                .await;
        }
    } else {
        tracing::info!(
            "Dry-run complete: {} files scanned, {} would be added, {} would be updated, {} unchanged, {} missing, {} errors",
            scanned,
            added,
            updated,
            unchanged,
            missing_count,
            errors
        );
        if let Some(ref state) = scan_state {
            state
                .log(
                    "INFO",
                    format!(
                        "Dry-run complete: {} files scanned, {} would be added, {} would be updated, {} unchanged, {} missing, {} errors",
                        scanned, added, updated, unchanged, missing_count, errors
                    ),
                )
                .await;
        }
    }

    Ok(FolderMissingFiles {
        folder_id,
        folder_path: base_path,
        missing_files: unseen_files,
    })
}

/// Resolve missing files: detect renames (including cross-library moves) and delete truly missing songs.
///
/// This function takes missing files info from ALL folders and:
/// 1. Detects renames by comparing partial_hash values across ALL libraries
/// 2. For renames: updates the old entry's file_path and music_folder_id, deletes the new entry
/// 3. For truly missing files: converts playlist entries to "missing" entries and deletes the songs
///
/// This enables moving songs between libraries without losing playlist entries, starred status, etc.
async fn resolve_missing_songs(
    database: &Database,
    all_missing_files: Vec<FolderMissingFiles>,
    dry_run: bool,
    scan_state: Option<Arc<crate::api::ScanState>>,
) -> Result<()> {
    // Collect all missing song IDs with their folder context
    struct MissingSong {
        id: String,
        old_relative_path: String,
        old_folder_id: i64,
        old_folder_path: PathBuf,
        partial_hash: Option<String>,
    }

    #[derive(FromQueryResult)]
    struct PartialHashRow {
        partial_hash: Option<String>,
    }

    #[derive(FromQueryResult)]
    struct RenameCandidateRow {
        id: String,
        file_path: String,
        music_folder_id: i64,
    }

    #[derive(FromQueryResult)]
    struct FileMtimeRow {
        file_mtime: Option<i64>,
    }

    #[derive(FromQueryResult)]
    struct SongMetaRow {
        title: String,
        artist_name: Option<String>,
        album_name: Option<String>,
        duration: i64,
    }

    let mut missing_songs: Vec<MissingSong> = Vec::new();

    for folder_info in &all_missing_files {
        for (relative_path, song_id) in &folder_info.missing_files {
            // Get partial hash for this song
            let hash = crate::db::raw::query_one::<PartialHashRow>(
                database.conn(),
                "SELECT partial_hash FROM songs WHERE id = ?",
                "SELECT partial_hash FROM songs WHERE id = $1",
                [Value::from(song_id.clone())],
            )
            .await?;

            missing_songs.push(MissingSong {
                id: song_id.clone(),
                old_relative_path: relative_path.clone(),
                old_folder_id: folder_info.folder_id,
                old_folder_path: folder_info.folder_path.clone(),
                partial_hash: hash.and_then(|row| row.partial_hash),
            });
        }
    }

    if missing_songs.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "Checking {} missing files for renames/moves...",
        missing_songs.len()
    );

    // Track which songs are renames vs truly removed
    let mut renamed_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut renamed_count = 0;
    let mut cross_library_moves = 0;

    // For each missing file with a hash, check if there's a newly added file with the same hash
    // across ALL libraries (not just the same library)
    for missing in &missing_songs {
        if let Some(ref hash) = missing.partial_hash {
            // Look for a different song with the same partial_hash in ANY folder
            // The new song must have been created during this scan (id != missing.id)
            let potential_rename = crate::db::raw::query_one::<RenameCandidateRow>(
                database.conn(),
                "SELECT id, file_path, music_folder_id FROM songs 
                 WHERE partial_hash = ? AND id != ?",
                "SELECT id, file_path, music_folder_id FROM songs 
                 WHERE partial_hash = $1 AND id != $2",
                [Value::from(hash.clone()), Value::from(missing.id.clone())],
            )
            .await?;

            if let Some(candidate) = potential_rename {
                let new_id = candidate.id;
                let new_relative_path = candidate.file_path;
                let new_folder_id = candidate.music_folder_id;
                // Get the folder path for the new location
                let new_folder_path = match crate::db::raw::query_scalar::<String>(
                    database.conn(),
                    "SELECT path FROM music_folders WHERE id = ?",
                    "SELECT path FROM music_folders WHERE id = $1",
                    [Value::from(new_folder_id)],
                )
                .await?
                {
                    Some(path) => PathBuf::from(path),
                    None => continue, // Folder not found, skip
                };

                // Verify the target file actually exists on disk
                let full_new_path = new_folder_path.join(&new_relative_path);
                if !full_new_path.exists() {
                    tracing::debug!(
                        "Skipping false rename detection: {} does not exist on disk",
                        full_new_path.display()
                    );
                    continue;
                }

                let is_cross_library = new_folder_id != missing.old_folder_id;
                let full_old_path = missing.old_folder_path.join(&missing.old_relative_path);

                // Found a genuine rename (or cross-library move)!
                if dry_run {
                    let move_type = if is_cross_library {
                        "cross-library move"
                    } else {
                        "rename"
                    };
                    tracing::info!(
                        "Would detect {}: {} -> {}",
                        move_type,
                        full_old_path.display(),
                        full_new_path.display()
                    );
                    if let Some(ref state) = scan_state {
                        state
                            .track_renamed(
                                &full_old_path.to_string_lossy(),
                                &full_new_path.to_string_lossy(),
                            )
                            .await;
                    }
                } else {
                    // Start a transaction for the rename/move
                    let tx = database.conn().begin().await?;

                    // Get the mtime from the new entry before deleting it
                    let new_mtime = crate::db::raw::query_one::<FileMtimeRow>(
                        &tx,
                        "SELECT file_mtime FROM songs WHERE id = ?",
                        "SELECT file_mtime FROM songs WHERE id = $1",
                        [Value::from(new_id.clone())],
                    )
                    .await?;

                    // Delete the newly created entry FIRST (to free up the file_path)
                    crate::db::raw::execute(
                        &tx,
                        "DELETE FROM songs WHERE id = ?",
                        "DELETE FROM songs WHERE id = $1",
                        [Value::from(new_id.clone())],
                    )
                    .await?;

                    // Update the old entry with new file_path, music_folder_id, and mtime
                    crate::db::raw::execute(
                        &tx,
                        "UPDATE songs SET 
                            file_path = ?,
                            music_folder_id = ?,
                            file_mtime = ?,
                            updated_at = datetime('now')
                         WHERE id = ?",
                        "UPDATE songs SET 
                            file_path = $1,
                            music_folder_id = $2,
                            file_mtime = $3,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = $4",
                        [
                            Value::from(new_relative_path.clone()),
                            Value::from(new_folder_id),
                            Value::from(new_mtime.and_then(|row| row.file_mtime)),
                            Value::from(missing.id.clone()),
                        ],
                    )
                    .await?;

                    tx.commit().await?;

                    let move_type = if is_cross_library {
                        "cross-library move"
                    } else {
                        "rename"
                    };
                    tracing::info!(
                        "Detected {}: {} -> {}",
                        move_type,
                        full_old_path.display(),
                        full_new_path.display()
                    );
                    if let Some(ref state) = scan_state {
                        state
                            .track_renamed(
                                &full_old_path.to_string_lossy(),
                                &full_new_path.to_string_lossy(),
                            )
                            .await;
                    }
                }

                renamed_ids.insert(missing.id.clone());
                renamed_count += 1;
                if is_cross_library {
                    cross_library_moves += 1;
                }
            }
        }
    }

    // Collect truly missing songs (not renamed/moved)
    let truly_missing: Vec<&MissingSong> = missing_songs
        .iter()
        .filter(|s| !renamed_ids.contains(&s.id))
        .collect();

    if truly_missing.is_empty() {
        if renamed_count > 0 {
            tracing::info!(
                "Resolved {} renames ({} cross-library moves), no files to remove",
                renamed_count,
                cross_library_moves
            );
        }
        return Ok(());
    }

    let remove_count = truly_missing.len();

    // Log and track removed files
    for missing in &truly_missing {
        let full_path = missing.old_folder_path.join(&missing.old_relative_path);
        tracing::info!("Missing file: {}", full_path.display());
    }

    if let Some(ref state) = scan_state {
        let full_paths: Vec<String> = truly_missing
            .iter()
            .map(|m| {
                m.old_folder_path
                    .join(&m.old_relative_path)
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        state.track_removed(&full_paths).await;
    }

    if dry_run {
        tracing::info!(
            "Dry-run: would remove {} missing files, {} renames detected ({} cross-library)",
            remove_count,
            renamed_count,
            cross_library_moves
        );
        return Ok(());
    }

    // Delete missing songs in a transaction
    let tx = database.conn().begin().await?;

    // First, convert all playlist entries for these songs to "missing" entries
    for missing in &truly_missing {
        // Get song metadata before deleting
        let song_meta = crate::db::raw::query_one::<SongMetaRow>(
            &tx,
            "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             WHERE s.id = ?",
            "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             WHERE s.id = $1",
            [Value::from(missing.id.clone())],
        )
        .await?;

        if let Some(song_meta) = song_meta {
            let title = song_meta.title;
            let artist_name = song_meta.artist_name;
            let album_name = song_meta.album_name;
            let duration = song_meta.duration;
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
            if let Some(ref a) = artist_name {
                parts.push(a.as_str());
            }
            if let Some(ref al) = album_name {
                parts.push(al.as_str());
            }
            parts.push(title.as_str());
            let search_text = parts.join(" - ");

            // Convert playlist entries to "missing" entries
            crate::db::raw::execute(
                &tx,
                "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = ?, missing_search_text = ? WHERE song_id = ?",
                "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = $1, missing_search_text = $2 WHERE song_id = $3",
                [
                    Value::from(missing_json),
                    Value::from(search_text),
                    Value::from(missing.id.clone()),
                ],
            )
            .await?;
        }

        // Delete the song
        crate::db::raw::execute(
            &tx,
            "DELETE FROM songs WHERE id = ?",
            "DELETE FROM songs WHERE id = $1",
            [Value::from(missing.id.clone())],
        )
        .await?;
    }

    // Update affected playlist totals
    crate::db::raw::execute(
        &tx,
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = playlists.id),
            updated_at = datetime('now')",
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = playlists.id),
            updated_at = CURRENT_TIMESTAMP",
        std::iter::empty::<Value>(),
    )
    .await?;

    // Clean up orphaned albums
    let orphaned_albums = crate::db::raw::query_scalar::<i64>(
        &tx,
        "SELECT COUNT(*) FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
        "SELECT COUNT(*) FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
        std::iter::empty::<Value>(),
    )
    .await?
    .unwrap_or(0);

    if orphaned_albums > 0 {
        crate::db::raw::execute(
            &tx,
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)",
            std::iter::empty::<Value>(),
        )
        .await?;
        tracing::info!("Removed {} orphaned albums", orphaned_albums);
    }

    // Clean up orphaned artists
    let orphaned_artists = crate::db::raw::query_scalar::<i64>(
        &tx,
        "SELECT COUNT(*) FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
         AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
        "SELECT COUNT(*) FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
         AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
        std::iter::empty::<Value>(),
    )
    .await?
    .unwrap_or(0);

    if orphaned_artists > 0 {
        crate::db::raw::execute(
            &tx,
            "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
             AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
            "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM songs) 
             AND id NOT IN (SELECT DISTINCT artist_id FROM albums)",
            std::iter::empty::<Value>(),
        )
        .await?;
        tracing::info!("Removed {} orphaned artists", orphaned_artists);
    }

    // Update album song counts and durations
    crate::db::raw::execute(
        &tx,
        "UPDATE albums SET 
            song_count = (SELECT COUNT(*) FROM songs WHERE songs.album_id = albums.id),
            duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE songs.album_id = albums.id)",
        "UPDATE albums SET 
            song_count = (SELECT COUNT(*) FROM songs WHERE songs.album_id = albums.id),
            duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE songs.album_id = albums.id)",
        std::iter::empty::<Value>(),
    )
    .await?;

    // Update artist album counts and song counts
    crate::db::raw::execute(
        &tx,
        "UPDATE artists SET 
            album_count = (SELECT COUNT(DISTINCT album_id) FROM songs WHERE songs.artist_id = artists.id AND album_id IS NOT NULL),
            song_count = (SELECT COUNT(*) FROM songs WHERE songs.artist_id = artists.id)",
        "UPDATE artists SET 
            album_count = (SELECT COUNT(DISTINCT album_id) FROM songs WHERE songs.artist_id = artists.id AND album_id IS NOT NULL),
            song_count = (SELECT COUNT(*) FROM songs WHERE songs.artist_id = artists.id)",
        std::iter::empty::<Value>(),
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        "Removed {} missing files, {} renames detected ({} cross-library moves)",
        remove_count,
        renamed_count,
        cross_library_moves
    );

    Ok(())
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
    cover_art_width: Option<u32>,
    cover_art_height: Option<u32>,
    // ReplayGain values - original from file tags
    original_replaygain_track_gain: Option<f64>,
    original_replaygain_track_peak: Option<f64>,
    // ReplayGain values - computed by scanner via EBU R128 analysis
    computed_replaygain_track_gain: Option<f64>,
    computed_replaygain_track_peak: Option<f64>,
    // Bliss audio analysis features for song similarity
    bliss_features: Option<Vec<u8>>,
    bliss_version: Option<i32>,
    // Pre-computed waveform data for visualization
    waveform_data: Option<Vec<u8>>,
}

async fn extract_metadata(
    database: &crate::db::Database,
    path: &Path,
    file_mtime: Option<i64>,
    analyze_replaygain: bool,
    #[cfg_attr(not(feature = "bliss"), allow(unused))] analyze_bliss: bool,
    analyze_waveform: bool,
    analysis_semaphore: &Semaphore,
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
    let (cover_art_hash, cover_art_width, cover_art_height) = {
        let full_path = path.to_path_buf();
        // Try to extract cover art (external first, then embedded)
        // We use block_in_place or spawn_blocking if we needed heavy lifting,
        // but here we just call async functions that do I/O
        match crate::thumbnails::find_external_cover_art(&full_path).await {
            Ok(data) => {
                match crate::thumbnails::ensure_cover_art_with_dimensions(database, &data).await {
                    Ok(result) => (Some(result.hash), Some(result.width), Some(result.height)),
                    Err(_) => (None, None, None),
                }
            }
            Err(_) => match crate::thumbnails::extract_embedded_cover_art(&full_path).await {
                Ok(data) => {
                    match crate::thumbnails::ensure_cover_art_with_dimensions(database, &data).await
                    {
                        Ok(result) => (Some(result.hash), Some(result.width), Some(result.height)),
                        Err(_) => (None, None, None),
                    }
                }
                Err(_) => (None, None, None),
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

    // Extract tags (including original ReplayGain values from file)
    let (
        title,
        artist,
        album,
        album_artist,
        track_number,
        disc_number,
        year,
        genre,
        original_replaygain_track_gain,
        original_replaygain_track_peak,
    ) = if let Some(tag) = tag {
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

        // Extract original ReplayGain tags from file
        // Format is typically "-6.50 dB" or just "-6.50"
        let original_replaygain_track_gain = tag
            .get_string(&lofty::tag::ItemKey::ReplayGainTrackGain)
            .and_then(parse_replaygain_value);

        // Peak is typically stored as a linear value like "0.988831" or "1.0"
        let original_replaygain_track_peak = tag
            .get_string(&lofty::tag::ItemKey::ReplayGainTrackPeak)
            .and_then(|s| s.trim().parse::<f64>().ok());

        (
            title,
            artist,
            album,
            album_artist,
            track_number,
            disc_number,
            year,
            genre,
            original_replaygain_track_gain,
            original_replaygain_track_peak,
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
            None,
            None,
        )
    };

    // Drop tagged_file before running CPU/memory-intensive audio analysis.
    // tagged_file holds all parsed tag data including embedded album art (potentially
    // 5-20MB per file), and we don't need it during ReplayGain/bliss decoding.
    drop(tagged_file);

    // Compute ReplayGain and/or waveform in a single shared decode pass if either is requested.
    // This avoids decoding the same file twice.
    let (computed_replaygain_track_gain, computed_replaygain_track_peak, waveform_data) =
        if analyze_replaygain || analyze_waveform {
            // Acquire semaphore permit to limit concurrent audio decoding.
            // Each decode loads the entire audio as f32 samples (~50-100MB per file).
            let _permit = analysis_semaphore.acquire().await.map_err(|_| {
                Error::Internal("Analysis semaphore closed unexpectedly".to_string())
            })?;
            let analyses: Vec<&str> = [
                analyze_replaygain.then_some("ReplayGain"),
                analyze_waveform.then_some("waveform"),
            ]
            .into_iter()
            .flatten()
            .collect();
            tracing::debug!(
                "Starting {} analysis for {}",
                analyses.join(" + "),
                path.display()
            );
            let path_clone = path.to_path_buf();
            let do_rg = analyze_replaygain;
            let do_wf = analyze_waveform;
            match tokio::task::spawn_blocking(move || {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::analysis::analyze_track(&path_clone, do_rg, do_wf)
                }))
            })
            .await
            {
                Ok(Ok(Ok(result))) => {
                    let rg_gain = result.replaygain.as_ref().map(|r| r.track_gain);
                    let rg_peak = result.replaygain.as_ref().map(|r| r.track_peak);
                    (rg_gain, rg_peak, result.waveform)
                }
                Ok(Ok(Err(e))) => {
                    tracing::warn!("Failed to analyze {}: {}", path.display(), e);
                    (None, None, None)
                }
                Ok(Err(panic)) => {
                    let msg = panic
                        .downcast_ref::<String>()
                        .map(|s| s.as_str())
                        .or_else(|| panic.downcast_ref::<&str>().copied())
                        .unwrap_or("unknown panic");
                    tracing::error!("Analysis panicked for {}: {}", path.display(), msg);
                    (None, None, None)
                }
                Err(e) => {
                    tracing::warn!("Analysis task failed for {}: {}", path.display(), e);
                    (None, None, None)
                }
            }
        } else {
            (None, None, None)
        };

    // Compute bliss audio features for song similarity if requested.
    // Skip files longer than the configured limit (default 20 minutes) — bliss
    // features are not very meaningful for e.g. long DJ mixes and analyzing
    // them consumes too much memory.
    #[cfg(feature = "bliss")]
    let (bliss_features, bliss_version) = if analyze_bliss {
        let bliss_max_duration_secs: u64 = std::env::var("FERROTUNE_BLISS_MAX_DURATION_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20 * 60);
        if duration > bliss_max_duration_secs {
            tracing::debug!(
                "Skipping bliss analysis for {} (duration {}s exceeds {}s limit)",
                path.display(),
                duration,
                bliss_max_duration_secs
            );
            (None, None)
        } else {
            // Acquire semaphore permit to limit concurrent audio decoding
            let _permit = analysis_semaphore.acquire().await.map_err(|_| {
                Error::Internal("Analysis semaphore closed unexpectedly".to_string())
            })?;
            tracing::debug!("Starting bliss analysis for {}", path.display());
            let path_clone = path.to_path_buf();
            // Run CPU-intensive bliss analysis on a blocking thread
            match tokio::task::spawn_blocking(move || {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::bliss::analyze_track(&path_clone)
                }))
            })
            .await
            {
                Ok(Ok(Ok(result))) => (
                    Some(crate::bliss::features_to_blob(&result.features)),
                    Some(result.version),
                ),
                Ok(Ok(Err(e))) => {
                    tracing::warn!("Failed to analyze bliss for {}: {}", path.display(), e);
                    (None, None)
                }
                Ok(Err(panic)) => {
                    let msg = panic
                        .downcast_ref::<String>()
                        .map(|s| s.as_str())
                        .or_else(|| panic.downcast_ref::<&str>().copied())
                        .unwrap_or("unknown panic");
                    tracing::error!("Bliss analysis panicked for {}: {}", path.display(), msg);
                    (None, None)
                }
                Err(e) => {
                    tracing::warn!("Bliss analysis task failed for {}: {}", path.display(), e);
                    (None, None)
                }
            }
        }
    } else {
        (None, None)
    };
    #[cfg(not(feature = "bliss"))]
    let (bliss_features, bliss_version): (Option<Vec<u8>>, Option<i32>) = (None, None);

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
        cover_art_width,
        cover_art_height,
        original_replaygain_track_gain,
        original_replaygain_track_peak,
        computed_replaygain_track_gain,
        computed_replaygain_track_peak,
        bliss_features,
        bliss_version,
        waveform_data,
    })
}

async fn upsert_song(
    database: &crate::db::Database,
    metadata: SongMetadata,
    file_path: String,
    folder_id: i64,
) -> Result<bool> {
    #[derive(FromQueryResult)]
    struct SongIdRow {
        id: String,
    }

    let SongMetadata {
        title,
        artist,
        album,
        album_artist,
        track_number,
        disc_number,
        year,
        genre,
        duration,
        bitrate,
        file_size,
        file_format,
        file_mtime,
        partial_hash,
        cover_art_hash,
        cover_art_width,
        cover_art_height,
        original_replaygain_track_gain,
        original_replaygain_track_peak,
        computed_replaygain_track_gain,
        computed_replaygain_track_peak,
        bliss_features,
        bliss_version,
        waveform_data,
    } = metadata;

    let tx = database.conn().begin().await?;

    let album_artist_name = album_artist.as_deref().unwrap_or(&artist).to_string();
    let album_artist_id = get_or_create_artist_raw(&tx, &album_artist_name).await?;
    let track_artist_id = get_or_create_artist_raw(&tx, &artist).await?;

    let album_id = if let Some(album_name) = album.as_deref() {
        Some(
            get_or_create_album_raw(
                &tx,
                album_name,
                &album_artist_id,
                year,
                genre.as_deref(),
                cover_art_hash.as_deref(),
                track_number,
                disc_number,
            )
            .await?,
        )
    } else {
        None
    };

    let track_number_i32 = track_number.map(|n| n as i32);
    let disc_number_i32 = disc_number.map(|n| n as i32).unwrap_or(1);
    let bitrate_i32 = bitrate.map(|b| b as i32);
    let duration_i64 = duration as i64;
    let file_size_i64 = file_size as i64;
    let cover_art_width_i32 = cover_art_width.map(|w| w as i32);
    let cover_art_height_i32 = cover_art_height.map(|h| h as i32);

    let existing = crate::db::raw::query_one::<SongIdRow>(
        &tx,
        "SELECT id FROM songs WHERE file_path = ? AND music_folder_id = ?",
        "SELECT id FROM songs WHERE file_path = $1 AND music_folder_id = $2",
        [Value::from(file_path.clone()), Value::from(folder_id)],
    )
    .await?;

    let is_new = existing.is_none();
    if let Some(existing) = existing {
        crate::db::raw::execute(
            &tx,
            "UPDATE songs SET 
                title = ?, album_id = ?, artist_id = ?, track_number = ?, 
                disc_number = ?, year = ?, genre = ?, duration = ?, 
                bitrate = ?, file_size = ?, file_format = ?, music_folder_id = ?,
                file_mtime = ?, partial_hash = ?, cover_art_hash = ?, 
                cover_art_width = ?, cover_art_height = ?,
                original_replaygain_track_gain = ?,
                original_replaygain_track_peak = ?,
                computed_replaygain_track_gain = COALESCE(?, computed_replaygain_track_gain),
                computed_replaygain_track_peak = COALESCE(?, computed_replaygain_track_peak),
                bliss_features = COALESCE(?, bliss_features),
                bliss_version = COALESCE(?, bliss_version),
                waveform_data = COALESCE(?, waveform_data),
                full_file_hash = NULL, updated_at = datetime('now')
             WHERE id = ?",
            "UPDATE songs SET 
                title = $1, album_id = $2, artist_id = $3, track_number = $4, 
                disc_number = $5, year = $6, genre = $7, duration = $8, 
                bitrate = $9, file_size = $10, file_format = $11, music_folder_id = $12,
                file_mtime = $13, partial_hash = $14, cover_art_hash = $15, 
                cover_art_width = $16, cover_art_height = $17,
                original_replaygain_track_gain = $18,
                original_replaygain_track_peak = $19,
                computed_replaygain_track_gain = COALESCE($20, computed_replaygain_track_gain),
                computed_replaygain_track_peak = COALESCE($21, computed_replaygain_track_peak),
                bliss_features = COALESCE($22, bliss_features),
                bliss_version = COALESCE($23, bliss_version),
                waveform_data = COALESCE($24, waveform_data),
                full_file_hash = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $25",
            [
                Value::from(title.clone()),
                Value::from(album_id.clone()),
                Value::from(track_artist_id.clone()),
                Value::from(track_number_i32),
                Value::from(disc_number_i32),
                Value::from(year),
                Value::from(genre.clone()),
                Value::from(duration_i64),
                Value::from(bitrate_i32),
                Value::from(file_size_i64),
                Value::from(file_format.clone()),
                Value::from(folder_id),
                Value::from(file_mtime),
                Value::from(partial_hash.clone()),
                Value::from(cover_art_hash.clone()),
                Value::from(cover_art_width_i32),
                Value::from(cover_art_height_i32),
                Value::from(original_replaygain_track_gain),
                Value::from(original_replaygain_track_peak),
                Value::from(computed_replaygain_track_gain),
                Value::from(computed_replaygain_track_peak),
                Value::from(bliss_features.clone()),
                Value::from(bliss_version),
                Value::from(waveform_data.clone()),
                Value::from(existing.id),
            ],
        )
        .await?;
    } else {
        let song_id = format!("so-{}", Uuid::new_v4());

        crate::db::raw::execute(
            &tx,
            "INSERT INTO songs (
                id, title, album_id, artist_id, track_number, disc_number,
                year, genre, duration, bitrate, file_path, file_size,
                file_format, music_folder_id, file_mtime, partial_hash, cover_art_hash,
                cover_art_width, cover_art_height,
                original_replaygain_track_gain, original_replaygain_track_peak,
                computed_replaygain_track_gain, computed_replaygain_track_peak,
                bliss_features, bliss_version, waveform_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
            "INSERT INTO songs (
                id, title, album_id, artist_id, track_number, disc_number,
                year, genre, duration, bitrate, file_path, file_size,
                file_format, music_folder_id, file_mtime, partial_hash, cover_art_hash,
                cover_art_width, cover_art_height,
                original_replaygain_track_gain, original_replaygain_track_peak,
                computed_replaygain_track_gain, computed_replaygain_track_peak,
                bliss_features, bliss_version, waveform_data,
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [
                Value::from(song_id),
                Value::from(title.clone()),
                Value::from(album_id.clone()),
                Value::from(track_artist_id.clone()),
                Value::from(track_number_i32),
                Value::from(disc_number_i32),
                Value::from(year),
                Value::from(genre.clone()),
                Value::from(duration_i64),
                Value::from(bitrate_i32),
                Value::from(file_path.clone()),
                Value::from(file_size_i64),
                Value::from(file_format.clone()),
                Value::from(folder_id),
                Value::from(file_mtime),
                Value::from(partial_hash.clone()),
                Value::from(cover_art_hash.clone()),
                Value::from(cover_art_width_i32),
                Value::from(cover_art_height_i32),
                Value::from(original_replaygain_track_gain),
                Value::from(original_replaygain_track_peak),
                Value::from(computed_replaygain_track_gain),
                Value::from(computed_replaygain_track_peak),
                Value::from(bliss_features.clone()),
                Value::from(bliss_version),
                Value::from(waveform_data.clone()),
            ],
        )
        .await?;
    }

    if let Some(album_id) = &album_id {
        crate::db::raw::execute(
            &tx,
            "UPDATE albums SET 
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = ?),
                duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = ?)
             WHERE id = ?",
            "UPDATE albums SET 
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = $1),
                duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = $2)
             WHERE id = $3",
            [
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
            ],
        )
        .await?;

        crate::db::raw::execute(
            &tx,
            "UPDATE albums SET 
                cover_art_hash = (
                    SELECT s.cover_art_hash FROM songs s 
                    WHERE s.album_id = ? 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                ),
                cover_art_width = (
                    SELECT s.cover_art_width FROM songs s 
                    WHERE s.album_id = ? 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                ),
                cover_art_height = (
                    SELECT s.cover_art_height FROM songs s 
                    WHERE s.album_id = ? 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                )
             WHERE id = ?",
            "UPDATE albums SET 
                cover_art_hash = (
                    SELECT s.cover_art_hash FROM songs s 
                    WHERE s.album_id = $1 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                ),
                cover_art_width = (
                    SELECT s.cover_art_width FROM songs s 
                    WHERE s.album_id = $2 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                ),
                cover_art_height = (
                    SELECT s.cover_art_height FROM songs s 
                    WHERE s.album_id = $3 
                    ORDER BY COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)
                    LIMIT 1
                )
             WHERE id = $4",
            [
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
            ],
        )
        .await?;
    }

    crate::db::raw::execute(
        &tx,
        "UPDATE artists SET 
            album_count = (SELECT COUNT(*) FROM albums WHERE artist_id = ?),
            song_count = (SELECT COUNT(*) FROM songs WHERE artist_id = ?)
         WHERE id = ?",
        "UPDATE artists SET 
            album_count = (SELECT COUNT(*) FROM albums WHERE artist_id = $1),
            song_count = (SELECT COUNT(*) FROM songs WHERE artist_id = $2)
         WHERE id = $3",
        [
            Value::from(album_artist_id.clone()),
            Value::from(album_artist_id.clone()),
            Value::from(album_artist_id),
        ],
    )
    .await?;

    tx.commit().await?;

    Ok(is_new)
}

async fn get_or_create_artist_raw(
    tx: &impl sea_orm::ConnectionTrait,
    name: &str,
) -> Result<String> {
    let existing = crate::db::raw::query_scalar::<String>(
        tx,
        "SELECT id FROM artists WHERE name = ? COLLATE NOCASE",
        "SELECT id FROM artists WHERE LOWER(name) = LOWER($1)",
        [Value::from(name.to_string())],
    )
    .await?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let artist_id = format!("ar-{}", Uuid::new_v4());
    crate::db::raw::execute(
        tx,
        "INSERT INTO artists (id, name, album_count, song_count) VALUES (?, ?, 0, 0)",
        "INSERT INTO artists (id, name, album_count, song_count) VALUES ($1, $2, 0, 0)",
        [
            Value::from(artist_id.clone()),
            Value::from(name.to_string()),
        ],
    )
    .await?;

    Ok(artist_id)
}

#[allow(clippy::too_many_arguments)]
async fn get_or_create_album_raw(
    tx: &impl sea_orm::ConnectionTrait,
    name: &str,
    artist_id: &str,
    year: Option<i32>,
    genre: Option<&str>,
    cover_art_hash: Option<&str>,
    disc_number: Option<u32>,
    track_number: Option<u32>,
) -> Result<String> {
    #[derive(FromQueryResult)]
    struct AlbumLookupRow {
        id: String,
        cover_art_hash: Option<String>,
    }

    #[derive(FromQueryResult)]
    struct EarliestTrackRow {
        disc_number: i64,
        track_number: i64,
    }

    let existing = crate::db::raw::query_one::<AlbumLookupRow>(
        tx,
        "SELECT id, cover_art_hash FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?",
        "SELECT id, cover_art_hash FROM albums WHERE LOWER(name) = LOWER($1) AND artist_id = $2",
        [
            Value::from(name.to_string()),
            Value::from(artist_id.to_string()),
        ],
    )
    .await?;

    if let Some(existing) = existing {
        let earliest = crate::db::raw::query_one::<EarliestTrackRow>(
            tx,
            "SELECT COALESCE(disc_number, 1) as disc_number, COALESCE(track_number, 1) as track_number FROM songs 
             WHERE album_id = ? 
             ORDER BY COALESCE(disc_number, 1), COALESCE(track_number, 1)
             LIMIT 1",
            "SELECT COALESCE(disc_number, 1)::BIGINT as disc_number, COALESCE(track_number, 1)::BIGINT as track_number FROM songs 
             WHERE album_id = $1 
             ORDER BY COALESCE(disc_number, 1), COALESCE(track_number, 1)
             LIMIT 1",
            [Value::from(existing.id.clone())],
        )
        .await?;

        let is_earliest_track = match earliest {
            Some(earliest) => {
                let this_disc = disc_number.unwrap_or(1) as i64;
                let this_track = track_number.unwrap_or(1) as i64;
                (this_disc, this_track) <= (earliest.disc_number, earliest.track_number)
            }
            None => true,
        };

        let should_update = cover_art_hash.is_some()
            && (existing.cover_art_hash.is_none()
                || (is_earliest_track && existing.cover_art_hash.as_deref() != cover_art_hash));

        if should_update {
            crate::db::raw::execute(
                tx,
                "UPDATE albums SET cover_art_hash = ? WHERE id = ?",
                "UPDATE albums SET cover_art_hash = $1 WHERE id = $2",
                [
                    Value::from(cover_art_hash.map(str::to_string)),
                    Value::from(existing.id.clone()),
                ],
            )
            .await?;
        }

        return Ok(existing.id);
    }

    let album_id = format!("al-{}", Uuid::new_v4());
    crate::db::raw::execute(
        tx,
        "INSERT INTO albums (id, name, artist_id, year, genre, created_at, cover_art_hash) 
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)",
        "INSERT INTO albums (id, name, artist_id, year, genre, created_at, cover_art_hash) 
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)",
        [
            Value::from(album_id.clone()),
            Value::from(name.to_string()),
            Value::from(artist_id.to_string()),
            Value::from(year),
            Value::from(genre.map(str::to_string)),
            Value::from(cover_art_hash.map(str::to_string)),
        ],
    )
    .await?;

    Ok(album_id)
}

/// Detect duplicate files by finding partial hash collisions and computing full hashes.
///
/// Phase 1: Find all songs with duplicate partial_hash values
/// Phase 2: For each collision group, compute full file hashes
/// Phase 3: Update full_file_hash in database and log duplicates
///
/// Returns the total number of duplicate files found.
async fn detect_duplicates(
    database: &Database,
    _folder_id: Option<i64>,
    scan_state: Option<Arc<ScanState>>,
) -> Result<u64> {
    #[derive(FromQueryResult)]
    struct CollisionHashRow {
        partial_hash: String,
    }

    #[derive(FromQueryResult)]
    struct DuplicateSongRow {
        id: String,
        file_path: String,
        music_folder_id: i64,
        file_size: i64,
        full_file_hash: Option<String>,
    }

    // Note: We no longer clear full_file_hash here. Instead, full_file_hash is cleared
    // in upsert_song when a file is modified, so cached hashes for unchanged files are preserved.

    // Find partial hash collisions (songs with the same partial_hash)
    let collision_hashes = crate::db::raw::query_all::<CollisionHashRow>(
        database.conn(),
        "SELECT partial_hash 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
        "SELECT partial_hash 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
        std::iter::empty::<Value>(),
    )
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
    for collision in collision_hashes {
        let partial_hash = collision.partial_hash;
        // Get all songs with this partial hash, including cached full_file_hash if present
        let songs = crate::db::raw::query_all::<DuplicateSongRow>(
            database.conn(),
            "SELECT s.id, s.file_path, s.music_folder_id, s.file_size, s.full_file_hash
             FROM songs s
             WHERE s.partial_hash = ?",
            "SELECT s.id, s.file_path, s.music_folder_id, s.file_size, s.full_file_hash
             FROM songs s
             WHERE s.partial_hash = $1",
            [Value::from(partial_hash.clone())],
        )
        .await?;

        // Get music folders to resolve full paths
        let folders = crate::db::repo::users::get_music_folders(database).await?;
        let folder_map: std::collections::HashMap<i64, String> =
            folders.into_iter().map(|f| (f.id, f.path)).collect();

        // Compute full hash for each song in the collision group
        let mut hash_to_songs: std::collections::HashMap<String, Vec<(String, String, i64)>> =
            std::collections::HashMap::new();

        for song in songs {
            // Get the base path for this music folder
            let base_path = match folder_map.get(&song.music_folder_id) {
                Some(p) => p,
                None => {
                    tracing::warn!(
                        "Unknown music folder {} for song {}",
                        song.music_folder_id,
                        song.id
                    );
                    continue;
                }
            };

            // Compute full filesystem path (used for display and hash computation)
            let full_path = PathBuf::from(base_path).join(&song.file_path);
            let full_path_str = full_path.to_string_lossy().to_string();

            // Use cached full_file_hash if available (file hasn't changed since last scan)
            let full_hash = if let Some(cached) = song.full_file_hash {
                cached
            } else {
                // For small files (where partial = full), use partial_hash as full_hash
                let computed_hash = if song.file_size as u64 <= PARTIAL_HASH_CHUNK_SIZE * 2 {
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

            hash_to_songs.entry(full_hash).or_default().push((
                song.id,
                full_path_str,
                song.file_size,
            ));
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
                    crate::db::raw::execute(
                        database.conn(),
                        "UPDATE songs SET full_file_hash = ? WHERE id = ?",
                        "UPDATE songs SET full_file_hash = $1 WHERE id = $2",
                        [Value::from(full_hash.clone()), Value::from(song_id.clone())],
                    )
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
async fn detect_duplicates_dry_run(database: &Database, _folder_id: Option<i64>) -> Result<()> {
    #[derive(FromQueryResult)]
    struct CollisionHashRow {
        partial_hash: String,
        cnt: i64,
    }

    #[derive(FromQueryResult)]
    struct DryRunSongRow {
        file_path: String,
        file_size: i64,
    }

    // Find partial hash collisions
    let collision_hashes = crate::db::raw::query_all::<CollisionHashRow>(
        database.conn(),
        "SELECT partial_hash, COUNT(*) as cnt 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
        "SELECT partial_hash, COUNT(*) as cnt 
         FROM songs 
         WHERE partial_hash IS NOT NULL 
         GROUP BY partial_hash 
         HAVING COUNT(*) > 1",
        std::iter::empty::<Value>(),
    )
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
    for collision in &collision_hashes {
        let songs = crate::db::raw::query_all::<DryRunSongRow>(
            database.conn(),
            "SELECT file_path, file_size FROM songs WHERE partial_hash = ?",
            "SELECT file_path, file_size FROM songs WHERE partial_hash = $1",
            [Value::from(collision.partial_hash.clone())],
        )
        .await?;

        tracing::info!(
            "Dry-run: {} files share partial hash {}:",
            collision.cnt,
            &collision.partial_hash[..16]
        );
        for song in &songs {
            tracing::info!("  - {} ({} bytes)", song.file_path, song.file_size);
        }
    }

    Ok(())
}
