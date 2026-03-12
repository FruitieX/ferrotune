//! API modules for Ferrotune.
//!
//! This module provides two separate APIs:
//!
//! - **`subsonic`**: OpenSubsonic-compatible API for music player clients (port 4040 by default)
//! - **`ferrotune`**: Admin/management API for Ferrotune-specific features (port 4041 by default)
//!
//! Additionally, when built with embedded UI assets (client/out exists at compile time),
//! the subsonic API will also serve the web client at the root path.

pub mod common;
pub mod embedded_ui;
pub mod ferrotune;
pub mod subsonic;

// Re-export commonly used items from subsonic for backward compatibility
pub use subsonic::first_string;
pub use subsonic::first_string_or_none;
pub use subsonic::string_or_seq;
pub use subsonic::QsQuery;

use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub use ferrotune::scan_state::{create_scan_state, ScanState};

/// Cached shuffle indices keyed by (user_id, shuffle_seed).
pub type ShuffleIndicesCache = RwLock<HashMap<(i64, i64), Arc<Vec<usize>>>>;

/// Shared application state for all API handlers.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: crate::config::Config,
    pub scan_state: Arc<ScanState>,
    /// Cache of parsed shuffle indices.
    /// Avoids re-parsing large JSON arrays on every queue window request.
    pub shuffle_cache: ShuffleIndicesCache,
}

/// Common query parameters for OpenSubsonic API requests.
#[derive(Debug, Deserialize)]
pub struct CommonParams {
    pub u: Option<String>,
    pub p: Option<String>,
    pub t: Option<String>,
    pub s: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    pub v: String,
    pub c: String,
    #[serde(default = "default_format")]
    pub f: String,
}

fn default_format() -> String {
    "xml".to_string()
}
