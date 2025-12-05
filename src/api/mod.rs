//! API modules for Ferrotune.
//!
//! This module provides two separate APIs:
//!
//! - **`subsonic`**: OpenSubsonic-compatible API for music player clients (port 4040 by default)
//! - **`ferrotune`**: Admin/management API for Ferrotune-specific features (port 4041 by default)
//!
//! Additionally, when built with embedded UI assets (client/out exists at compile time),
//! the subsonic API will also serve the web client at the root path.

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
use std::sync::Arc;

pub use ferrotune::scan_state::{create_scan_state, ScanState};

/// Shared application state for all API handlers.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: crate::config::Config,
    pub scan_state: Arc<ScanState>,
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
