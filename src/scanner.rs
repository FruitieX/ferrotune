use crate::config::Config;
use crate::error::{Error, Result};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

pub async fn scan_library(
    pool: &SqlitePool,
    config: &Config,
    full: bool,
    folder_id: Option<i64>,
    dry_run: bool,
) -> Result<()> {
    let folders = if let Some(id) = folder_id {
        vec![get_music_folder(pool, id).await?]
    } else {
        crate::db::queries::get_music_folders(pool).await?
    };

    for folder in folders {
        tracing::info!("Scanning folder: {} ({})", folder.name, folder.path);
        scan_folder(pool, config, folder.id, &folder.path, full, dry_run).await?;
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

async fn scan_folder(
    pool: &SqlitePool,
    _config: &Config,
    folder_id: i64,
    folder_path: &str,
    full: bool,
    dry_run: bool,
) -> Result<()> {
    let base_path = PathBuf::from(folder_path);
    let supported_extensions = ["mp3", "flac", "ogg", "opus", "m4a", "mp4", "aac", "wav"];

    let mut scanned = 0;
    let mut added = 0;
    let mut updated = 0;
    let mut errors = 0;

    // First, clean up missing files (only for this folder)
    let removed = clean_missing_files(pool, folder_id, &base_path, dry_run).await?;

    for entry in WalkDir::new(&base_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Skip directories
        if !path.is_file() {
            continue;
        }

        // Check if file has supported extension
        if let Some(ext) = path.extension() {
            if !supported_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                continue;
            }
        } else {
            continue;
        }

        scanned += 1;

        // Get relative path from base
        let relative_path = path
            .strip_prefix(&base_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // Get file modification time (used for incremental scanning)
        let file_mtime = std::fs::metadata(path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        // Check if file already exists in database
        let existing: Option<(String, Option<i64>)> =
            sqlx::query_as("SELECT id, file_mtime FROM songs WHERE file_path = ?")
                .bind(&relative_path)
                .fetch_optional(pool)
                .await?;

        if !full {
            if let Some((_, stored_mtime)) = &existing {
                // Skip if file hasn't been modified since last scan
                if file_mtime.is_some() && stored_mtime == &file_mtime {
                    continue;
                }
            }
        }

        // In dry-run mode, just count what would be added/updated
        if dry_run {
            if existing.is_none() {
                tracing::info!("Would add: {}", relative_path);
                added += 1;
            } else {
                tracing::info!("Would update: {}", relative_path);
                updated += 1;
            }
            continue;
        }

        // Extract metadata (pass file_mtime to avoid re-reading it)
        match extract_metadata(path, file_mtime).await {
            Ok(metadata) => match upsert_song(pool, metadata, relative_path, folder_id).await {
                Ok(is_new) => {
                    if is_new {
                        added += 1;
                    } else {
                        updated += 1;
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to save song metadata: {}", e);
                    errors += 1;
                }
            },
            Err(e) => {
                tracing::debug!("Failed to extract metadata from {}: {}", path.display(), e);
                errors += 1;
            }
        }

        if scanned % 100 == 0 {
            tracing::info!(
                "Progress: {} files scanned, {} added, {} updated, {} errors",
                scanned,
                added,
                updated,
                errors
            );
        }
    }

    if !dry_run {
        tracing::info!(
            "Scan complete: {} files scanned, {} added, {} updated, {} removed, {} errors",
            scanned,
            added,
            updated,
            removed,
            errors
        );
    } else {
        tracing::info!(
            "Dry-run complete: {} files scanned, {} would be added, {} would be updated, {} would be removed, {} errors",
            scanned,
            added,
            updated,
            removed,
            errors
        );
    }

    Ok(())
}

/// Remove database entries for files that no longer exist on disk.
/// Returns the number of songs removed (or that would be removed in dry-run mode).
/// Only checks songs belonging to the specified music folder.
async fn clean_missing_files(
    pool: &SqlitePool,
    folder_id: i64,
    base_path: &Path,
    dry_run: bool,
) -> Result<usize> {
    // Get songs from this specific folder only
    let songs: Vec<(String, String)> =
        sqlx::query_as("SELECT id, file_path FROM songs WHERE music_folder_id = ?")
            .bind(folder_id)
            .fetch_all(pool)
            .await?;

    let mut missing_ids = Vec::new();

    for (id, file_path) in &songs {
        let full_path = base_path.join(file_path);
        if !full_path.exists() {
            tracing::info!("Missing file: {}", file_path);
            missing_ids.push(id.clone());
        }
    }

    if missing_ids.is_empty() {
        return Ok(0);
    }

    let count = missing_ids.len();

    if dry_run {
        tracing::info!(
            "Dry-run: would remove {} missing files from database",
            count
        );
        return Ok(count);
    }

    // Delete missing songs in a transaction
    let mut tx = pool.begin().await?;

    for id in &missing_ids {
        sqlx::query("DELETE FROM songs WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

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

    tracing::info!("Removed {} missing files from database", count);

    Ok(count)
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
}

async fn extract_metadata(path: &Path, file_mtime: Option<i64>) -> Result<SongMetadata> {
    let tagged_file = Probe::open(path)
        .map_err(|e| Error::Lofty(e))?
        .read()
        .map_err(|e| Error::Lofty(e))?;

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
        sqlx::query(
            "UPDATE songs SET 
                title = ?, album_id = ?, artist_id = ?, track_number = ?, 
                disc_number = ?, year = ?, genre = ?, duration = ?, 
                bitrate = ?, file_size = ?, file_format = ?, music_folder_id = ?,
                file_mtime = ?, updated_at = datetime('now')
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
                file_format, music_folder_id, file_mtime, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
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
}

async fn get_or_create_album(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    name: &str,
    artist_id: &str,
    _artist_name: &str,
    year: Option<i32>,
    genre: Option<&str>,
) -> Result<String> {
    // Try to find existing album by name and artist
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?")
            .bind(name)
            .bind(artist_id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some((id,)) = existing {
        Ok(id)
    } else {
        // Create new album
        let album_id = format!("al-{}", Uuid::new_v4());

        sqlx::query(
            "INSERT INTO albums (id, name, artist_id, year, genre, song_count, duration, created_at)
             VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'))"
        )
        .bind(&album_id)
        .bind(name)
        .bind(artist_id)
        .bind(year)
        .bind(genre)
        .execute(&mut **tx)
        .await?;

        Ok(album_id)
    }
}
