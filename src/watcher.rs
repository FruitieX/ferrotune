//! File system watcher for automatic library scanning.
//!
//! This module monitors music folders that have `watch_enabled = true` and
//! automatically triggers incremental scans when files are added, modified, or removed.
//!
//! Features:
//! - Debounced events (5 second window) to batch rapid changes
//! - Only watches folders with `watch_enabled = true`
//! - Integrates with existing scanner infrastructure
//! - Thread-safe event aggregation

use crate::api::ScanState;
use crate::db::{models::MusicFolder, Database};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Semaphore};
use tracing::{debug, error, info, warn};

/// Duration to wait after file changes before triggering scan
const DEBOUNCE_DURATION: Duration = Duration::from_secs(5);

/// Message sent from file watcher to scan trigger
#[derive(Debug)]
pub enum WatcherMessage {
    /// Files changed in a music folder - includes specific file paths
    FilesChanged {
        folder_id: i64,
        file_paths: Vec<PathBuf>,
    },
    /// Watcher error
    Error(String),
}

/// File system watcher that triggers scans on changes
pub struct LibraryWatcher {
    /// Runtime database handle
    pool: Database,
    /// Shared scan state for progress updates (reserved for future use)
    #[allow(dead_code)]
    scan_state: Arc<ScanState>,
    /// Channel sender for watcher messages
    tx: mpsc::Sender<WatcherMessage>,
    /// Tracked folder paths and their IDs
    watched_folders: std::sync::Mutex<Vec<(i64, PathBuf)>>,
    /// Limits concurrent auto-scans triggered by watcher events
    scan_semaphore: Arc<Semaphore>,
}

impl LibraryWatcher {
    /// Create a new library watcher
    /// Returns the watcher and the receiver for watcher messages
    pub fn new(
        pool: Database,
        scan_state: Arc<ScanState>,
    ) -> (Self, mpsc::Receiver<WatcherMessage>) {
        let (tx, rx) = mpsc::channel(100);
        (
            Self {
                pool,
                scan_state,
                tx,
                watched_folders: std::sync::Mutex::new(Vec::new()),
                scan_semaphore: Arc::new(Semaphore::new(2)),
            },
            rx,
        )
    }

    /// Start watching music folders with watch_enabled = true
    ///
    /// This spawns background tasks for:
    /// 1. The file system watcher itself
    /// 2. A scan trigger that processes debounced events
    pub async fn start(self: Arc<Self>, rx: mpsc::Receiver<WatcherMessage>) -> anyhow::Result<()> {
        // Load folders to watch
        let folders = self.load_watch_enabled_folders().await?;

        if folders.is_empty() {
            info!("No music folders with watch_enabled=true, file watcher not started");
            return Ok(());
        }

        info!("Starting file watcher for {} folder(s)", folders.len());

        // Store watched folders
        {
            let mut watched = self.watched_folders.lock().unwrap();
            *watched = folders
                .iter()
                .map(|f| (f.id, PathBuf::from(&f.path)))
                .collect();
        }

        // Clone for the watcher task (reserved for future enhancements)
        let _watcher_self = Arc::clone(&self);
        let tx = self.tx.clone();

        // Spawn the file watcher
        let folders_to_watch: Vec<_> = folders.iter().map(|f| (f.id, f.path.clone())).collect();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = run_watcher(folders_to_watch, tx) {
                error!("File watcher error: {}", e);
            }
        });

        // Spawn the scan trigger task
        let trigger_self = Arc::clone(&self);
        tokio::spawn(async move {
            trigger_self.run_scan_trigger(rx).await;
        });

        Ok(())
    }

    /// Load music folders that have watch_enabled = true
    async fn load_watch_enabled_folders(&self) -> anyhow::Result<Vec<MusicFolder>> {
        let folders: Vec<MusicFolder> = if let Ok(pool) = self.pool.sqlite_pool() {
            sqlx::query_as(
                "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error 
                 FROM music_folders 
                 WHERE enabled = 1 AND watch_enabled = 1",
            )
            .fetch_all(pool)
            .await?
        } else {
            let pool = self.pool.postgres_pool()?;
            sqlx::query_as(
                "SELECT id, name, path, enabled, watch_enabled, last_scanned_at, scan_error 
                 FROM music_folders 
                 WHERE enabled AND watch_enabled",
            )
            .fetch_all(pool)
            .await?
        };

        Ok(folders)
    }

    /// Process watcher messages and trigger scans
    async fn run_scan_trigger(self: Arc<Self>, mut rx: mpsc::Receiver<WatcherMessage>) {
        while let Some(msg) = rx.recv().await {
            match msg {
                WatcherMessage::FilesChanged {
                    folder_id,
                    file_paths,
                } => {
                    info!(
                        "Processing {} file change(s) in folder {}",
                        file_paths.len(),
                        folder_id
                    );

                    let pool = self.pool.clone();
                    let scan_semaphore = Arc::clone(&self.scan_semaphore);

                    // Spawn scan in background - use targeted file scanning
                    tokio::spawn(async move {
                        let permit = match scan_semaphore.acquire_owned().await {
                            Ok(permit) => permit,
                            Err(e) => {
                                error!("Failed to acquire scan semaphore: {}", e);
                                return;
                            }
                        };

                        if let Err(e) =
                            crate::scanner::scan_specific_files(&pool, folder_id, file_paths).await
                        {
                            error!("Auto-scan for folder {} failed: {}", folder_id, e);
                        } else {
                            info!("Auto-scan for folder {} completed", folder_id);
                        }

                        drop(permit);
                    });
                }
                WatcherMessage::Error(e) => {
                    error!("Watcher error: {}", e);
                }
            }
        }
    }

    /// Reload watched folders (call when watch_enabled changes)
    #[allow(dead_code)]
    pub async fn reload(&self) -> anyhow::Result<()> {
        let folders = self.load_watch_enabled_folders().await?;

        let mut watched = self.watched_folders.lock().unwrap();
        *watched = folders
            .iter()
            .map(|f| (f.id, PathBuf::from(&f.path)))
            .collect();

        info!(
            "Reloaded file watcher, now watching {} folder(s)",
            folders.len()
        );

        // Note: In a full implementation, we would need to restart the
        // actual notify watcher here. For now, this just updates our tracking.

        Ok(())
    }
}

/// Run the actual file system watcher (blocking)
fn run_watcher(
    folders: Vec<(i64, String)>,
    tx: mpsc::Sender<WatcherMessage>,
) -> anyhow::Result<()> {
    // Create a debounced watcher with 5 second timeout
    let (debounced_tx, debounced_rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(DEBOUNCE_DURATION, debounced_tx)?;

    // Add watches for each folder
    for (folder_id, path) in &folders {
        let path = PathBuf::from(path);
        if path.exists() {
            match debouncer.watcher().watch(&path, RecursiveMode::Recursive) {
                Ok(()) => {
                    info!("Watching folder {} at {:?}", folder_id, path);
                }
                Err(e) => {
                    warn!("Failed to watch folder {} at {:?}: {}", folder_id, path, e);
                }
            }
        } else {
            warn!("Cannot watch non-existent folder: {:?}", path);
        }
    }

    // Create a map from path prefix to folder_id
    let path_to_folder: Vec<_> = folders
        .iter()
        .map(|(id, p)| (*id, PathBuf::from(p)))
        .collect();

    // Process debounced events
    loop {
        match debounced_rx.recv() {
            Ok(Ok(events)) => {
                // Collect unique affected folders with their file paths
                let mut folder_files: std::collections::HashMap<i64, Vec<PathBuf>> =
                    std::collections::HashMap::new();

                for event in events {
                    debug!("File event: {:?} - {:?}", event.kind, event.path);

                    // Only process relevant events
                    if matches!(
                        event.kind,
                        DebouncedEventKind::Any | DebouncedEventKind::AnyContinuous
                    ) {
                        // Find the folder this path belongs to
                        for (folder_id, folder_path) in &path_to_folder {
                            if event.path.starts_with(folder_path) {
                                // Check if it's an audio file (or was - might be deleted)
                                if is_audio_file(&event.path) {
                                    folder_files
                                        .entry(*folder_id)
                                        .or_default()
                                        .push(event.path.clone());
                                    break;
                                }
                            }
                        }
                    }
                }

                // Send messages for affected folders with their specific file paths
                for (folder_id, file_paths) in folder_files {
                    let _ = tx.blocking_send(WatcherMessage::FilesChanged {
                        folder_id,
                        file_paths,
                    });
                }
            }
            Ok(Err(error)) => {
                warn!("Watcher error: {:?}", error);
                let _ = tx.blocking_send(WatcherMessage::Error(format!("{:?}", error)));
            }
            Err(e) => {
                error!("Watcher channel error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

/// Check if a path is an audio file we care about
fn is_audio_file(path: &std::path::Path) -> bool {
    const AUDIO_EXTENSIONS: &[&str] = &[
        "mp3", "flac", "ogg", "m4a", "aac", "wav", "opus", "wma", "aiff", "alac",
    ];

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file(&PathBuf::from("/music/song.mp3")));
        assert!(is_audio_file(&PathBuf::from("/music/song.FLAC")));
        assert!(is_audio_file(&PathBuf::from("/music/song.m4a")));
        assert!(!is_audio_file(&PathBuf::from("/music/cover.jpg")));
        assert!(!is_audio_file(&PathBuf::from("/music/playlist.m3u")));
    }
}
