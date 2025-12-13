//! Shared scan state for async scanning with progress tracking.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use ts_rs::TS;

/// A log entry from the scan process.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanLogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// A scan detail entry describing a file affected by the scan.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanDetailEntry {
    /// The file path
    pub path: String,
    /// Optional error message if this is an error entry
    #[ts(optional)]
    pub error: Option<String>,
}

/// Scan details response containing lists of affected files.
#[derive(Clone, Debug, Serialize, Default, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanDetails {
    /// Files that were added
    pub added: Vec<ScanDetailEntry>,
    /// Files that were updated
    pub updated: Vec<ScanDetailEntry>,
    /// Files that were unchanged (scanned but not needing updates)
    pub unchanged: Vec<ScanDetailEntry>,
    /// Files that were removed
    pub removed: Vec<ScanDetailEntry>,
    /// Duplicate files found
    pub duplicates: Vec<ScanDetailEntry>,
    /// Files with errors
    pub errors: Vec<ScanDetailEntry>,
}

/// Scan progress update sent via SSE.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanProgressUpdate {
    /// Whether a scan is currently in progress
    pub scanning: bool,
    /// Number of files scanned so far
    #[ts(type = "number")]
    pub scanned: u64,
    /// Total files to scan (if known)
    #[ts(type = "number | null")]
    pub total: Option<u64>,
    /// Number of files added
    #[ts(type = "number")]
    pub added: u64,
    /// Number of files updated
    #[ts(type = "number")]
    pub updated: u64,
    /// Number of files unchanged (scanned but no update needed)
    #[ts(type = "number")]
    pub unchanged: u64,
    /// Number of files removed (orphans)
    #[ts(type = "number")]
    pub removed: u64,
    /// Number of errors encountered
    #[ts(type = "number")]
    pub errors: u64,
    /// Number of duplicate files detected
    #[ts(type = "number")]
    pub duplicates: u64,
    /// Current folder being scanned
    pub current_folder: Option<String>,
    /// Current file being processed
    pub current_file: Option<String>,
    /// Scan mode (incremental, full, dry-run)
    pub mode: String,
    /// Whether this is a final update (scan complete)
    pub finished: bool,
    /// Error message if scan failed
    pub error: Option<String>,
}

impl Default for ScanProgressUpdate {
    fn default() -> Self {
        Self {
            scanning: false,
            scanned: 0,
            total: None,
            added: 0,
            updated: 0,
            unchanged: 0,
            removed: 0,
            errors: 0,
            duplicates: 0,
            current_folder: None,
            current_file: None,
            mode: "incremental".to_string(),
            finished: false,
            error: None,
        }
    }
}

/// Shared state for tracking scan progress.
/// Uses atomics for counters to allow lock-free updates from the scanner.
pub struct ScanState {
    /// Whether a scan is currently running
    scanning: AtomicBool,
    /// Counter values (lock-free updates)
    scanned: AtomicU64,
    added: AtomicU64,
    updated: AtomicU64,
    unchanged: AtomicU64,
    removed: AtomicU64,
    errors: AtomicU64,
    duplicates: AtomicU64,
    total: RwLock<Option<u64>>,
    /// String fields (require locks)
    current_folder: RwLock<Option<String>>,
    current_file: RwLock<Option<String>>,
    mode: RwLock<String>,
    finished: AtomicBool,
    error: RwLock<Option<String>>,
    /// Cancellation flag
    cancelled: AtomicBool,
    /// Channel for broadcasting progress updates
    tx: broadcast::Sender<ScanProgressUpdate>,
    /// Recent log entries (limited buffer)
    logs: RwLock<Vec<ScanLogEntry>>,
    /// Detailed lists of affected files
    details: RwLock<ScanDetails>,
}

impl ScanState {
    /// Create a new scan state with a broadcast channel.
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            scanning: AtomicBool::new(false),
            scanned: AtomicU64::new(0),
            added: AtomicU64::new(0),
            updated: AtomicU64::new(0),
            unchanged: AtomicU64::new(0),
            removed: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            duplicates: AtomicU64::new(0),
            total: RwLock::new(None),
            current_folder: RwLock::new(None),
            current_file: RwLock::new(None),
            mode: RwLock::new("incremental".to_string()),
            finished: AtomicBool::new(false),
            error: RwLock::new(None),
            cancelled: AtomicBool::new(false),
            tx,
            logs: RwLock::new(Vec::new()),
            details: RwLock::new(ScanDetails::default()),
        }
    }

    /// Check if a scan is currently in progress.
    pub fn is_scanning(&self) -> bool {
        self.scanning.load(Ordering::Relaxed)
    }

    /// Check if the scan has been cancelled.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// Get the current progress.
    pub async fn get_progress(&self) -> ScanProgressUpdate {
        ScanProgressUpdate {
            scanning: self.scanning.load(Ordering::Relaxed),
            scanned: self.scanned.load(Ordering::Relaxed),
            total: *self.total.read().await,
            added: self.added.load(Ordering::Relaxed),
            updated: self.updated.load(Ordering::Relaxed),
            unchanged: self.unchanged.load(Ordering::Relaxed),
            removed: self.removed.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            duplicates: self.duplicates.load(Ordering::Relaxed),
            current_folder: self.current_folder.read().await.clone(),
            current_file: self.current_file.read().await.clone(),
            mode: self.mode.read().await.clone(),
            finished: self.finished.load(Ordering::Relaxed),
            error: self.error.read().await.clone(),
        }
    }

    /// Subscribe to progress updates.
    pub fn subscribe(&self) -> broadcast::Receiver<ScanProgressUpdate> {
        self.tx.subscribe()
    }

    /// Get recent log entries.
    pub async fn get_logs(&self) -> Vec<ScanLogEntry> {
        self.logs.read().await.clone()
    }

    /// Get scan details (lists of affected files).
    pub async fn get_details(&self) -> ScanDetails {
        self.details.read().await.clone()
    }

    /// Start a new scan. Returns false if a scan is already in progress.
    pub async fn start(&self, mode: String) -> bool {
        // Use compare_exchange to atomically check and set
        if self
            .scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }

        // Reset all counters
        self.scanned.store(0, Ordering::Relaxed);
        self.added.store(0, Ordering::Relaxed);
        self.updated.store(0, Ordering::Relaxed);
        self.unchanged.store(0, Ordering::Relaxed);
        self.removed.store(0, Ordering::Relaxed);
        self.errors.store(0, Ordering::Relaxed);
        self.duplicates.store(0, Ordering::Relaxed);
        self.finished.store(false, Ordering::Relaxed);
        self.cancelled.store(false, Ordering::Relaxed);

        // Reset string fields
        *self.total.write().await = None;
        *self.current_folder.write().await = None;
        *self.current_file.write().await = None;
        *self.mode.write().await = mode;
        *self.error.write().await = None;

        // Clear logs on new scan
        self.logs.write().await.clear();

        // Clear details on new scan
        *self.details.write().await = ScanDetails::default();

        // Broadcast the initial state
        let _ = self.tx.send(self.get_progress().await);
        true
    }

    /// Increment the scanned counter and optionally broadcast.
    pub fn increment_scanned(&self) {
        self.scanned.fetch_add(1, Ordering::Relaxed);
    }

    /// Increment the added counter and track the file.
    pub async fn track_added(&self, path: &str) {
        self.added.fetch_add(1, Ordering::Relaxed);
        self.details.write().await.added.push(ScanDetailEntry {
            path: path.to_string(),
            error: None,
        });
    }

    /// Increment the updated counter and track the file.
    pub async fn track_updated(&self, path: &str) {
        self.updated.fetch_add(1, Ordering::Relaxed);
        self.details.write().await.updated.push(ScanDetailEntry {
            path: path.to_string(),
            error: None,
        });
    }

    /// Increment the unchanged counter and track the file.
    pub async fn track_unchanged(&self, path: &str) {
        self.unchanged.fetch_add(1, Ordering::Relaxed);
        self.details.write().await.unchanged.push(ScanDetailEntry {
            path: path.to_string(),
            error: None,
        });
    }

    /// Increment the added counter (without tracking - for backwards compatibility).
    #[allow(dead_code)]
    pub fn increment_added(&self) {
        self.added.fetch_add(1, Ordering::Relaxed);
    }

    /// Increment the updated counter (without tracking - for backwards compatibility).
    #[allow(dead_code)]
    pub fn increment_updated(&self) {
        self.updated.fetch_add(1, Ordering::Relaxed);
    }

    /// Increment the removed counter.
    #[allow(dead_code)]
    pub fn increment_removed(&self) {
        self.removed.fetch_add(1, Ordering::Relaxed);
    }

    /// Add removed files to tracking.
    pub async fn track_removed(&self, paths: &[String]) {
        self.removed
            .fetch_add(paths.len() as u64, Ordering::Relaxed);
        let mut details = self.details.write().await;
        for path in paths {
            details.removed.push(ScanDetailEntry {
                path: path.clone(),
                error: None,
            });
        }
    }

    /// Add to the removed counter (without tracking - for backwards compatibility).
    #[allow(dead_code)]
    pub fn add_removed(&self, count: u64) {
        self.removed.fetch_add(count, Ordering::Relaxed);
    }

    /// Increment the errors counter and track the file.
    pub async fn track_error(&self, path: &str, error: &str) {
        self.errors.fetch_add(1, Ordering::Relaxed);
        self.details.write().await.errors.push(ScanDetailEntry {
            path: path.to_string(),
            error: Some(error.to_string()),
        });
    }

    /// Increment the errors counter (without tracking - for backwards compatibility).
    #[allow(dead_code)]
    pub fn increment_errors(&self) {
        self.errors.fetch_add(1, Ordering::Relaxed);
    }

    /// Track duplicate files.
    pub async fn track_duplicates(&self, paths: &[String]) {
        self.duplicates
            .fetch_add(paths.len() as u64, Ordering::Relaxed);
        let mut details = self.details.write().await;
        for path in paths {
            details.duplicates.push(ScanDetailEntry {
                path: path.clone(),
                error: None,
            });
        }
    }

    /// Add to the duplicates counter (without tracking - for backwards compatibility).
    #[allow(dead_code)]
    pub fn add_duplicates(&self, count: u64) {
        self.duplicates.fetch_add(count, Ordering::Relaxed);
    }

    /// Set the total count.
    #[allow(dead_code)]
    pub async fn set_total(&self, total: u64) {
        *self.total.write().await = Some(total);
    }

    /// Set the current folder being scanned.
    pub async fn set_current_folder(&self, folder: Option<String>) {
        *self.current_folder.write().await = folder;
    }

    /// Set the current file being processed.
    pub async fn set_current_file(&self, file: Option<String>) {
        *self.current_file.write().await = file;
    }

    /// Broadcast the current progress to all subscribers.
    pub async fn broadcast(&self) {
        let _ = self.tx.send(self.get_progress().await);
    }

    /// Add a log entry.
    pub async fn log(&self, level: &str, message: impl Into<String>) {
        let entry = ScanLogEntry {
            timestamp: chrono::Utc::now().format("%H:%M:%S%.3f").to_string(),
            level: level.to_string(),
            message: message.into(),
        };

        let mut logs = self.logs.write().await;
        logs.push(entry);

        // Keep only last 1000 log entries
        if logs.len() > 1000 {
            logs.drain(0..100);
        }
    }

    /// Mark scan as complete (successful).
    pub async fn complete(&self) {
        self.scanning.store(false, Ordering::Relaxed);
        self.finished.store(true, Ordering::Relaxed);
        *self.current_folder.write().await = None;
        *self.current_file.write().await = None;
        let _ = self.tx.send(self.get_progress().await);
    }

    /// Mark scan as failed.
    pub async fn fail(&self, error: String) {
        self.scanning.store(false, Ordering::Relaxed);
        self.finished.store(true, Ordering::Relaxed);
        *self.error.write().await = Some(error);
        *self.current_folder.write().await = None;
        *self.current_file.write().await = None;
        let _ = self.tx.send(self.get_progress().await);
    }

    /// Cancel the current scan.
    pub async fn cancel(&self) {
        if self.scanning.load(Ordering::Relaxed) {
            self.cancelled.store(true, Ordering::Relaxed);
            // The scanner will check is_cancelled() and stop
        }
    }
}

impl Default for ScanState {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a new shared scan state.
pub fn create_scan_state() -> Arc<ScanState> {
    Arc::new(ScanState::new())
}
