//! Library scanning endpoints.

use crate::api::ferrotune::ErrorResponse;
use crate::api::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Request body for starting a scan.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    /// If true, rescan all files even if they haven't changed.
    #[serde(default)]
    pub full: bool,

    /// Optional folder ID to scan (if not provided, scans all folders).
    #[serde(default)]
    pub folder_id: Option<i64>,

    /// If true, only show what would be done without making changes.
    #[serde(default)]
    pub dry_run: bool,
}

/// Response from a scan operation.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanResponse {
    pub status: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanned: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<u64>,
}

/// Start a library scan.
///
/// This endpoint triggers a synchronous library scan. For large libraries,
/// this may take some time to complete.
///
/// ## Request Body
///
/// ```json
/// {
///   "full": false,      // Optional: rescan all files
///   "folderId": null,   // Optional: specific folder to scan
///   "dryRun": false     // Optional: preview changes without applying
/// }
/// ```
pub async fn start_scan(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ScanRequest>,
) -> impl IntoResponse {
    let mode = if request.dry_run {
        "dry-run"
    } else if request.full {
        "full"
    } else {
        "incremental"
    };

    tracing::info!(
        "Starting {} scan via API (folder_id: {:?})",
        mode,
        request.folder_id
    );

    match crate::scanner::scan_library(
        &state.pool,
        &state.config,
        request.full,
        request.folder_id,
        request.dry_run,
    )
    .await
    {
        Ok(()) => {
            let message = if request.dry_run {
                "Dry-run scan completed".to_string()
            } else {
                "Library scan completed".to_string()
            };

            (
                StatusCode::OK,
                Json(ScanResponse {
                    status: "ok",
                    message,
                    // TODO: Return actual counts from scan_library
                    scanned: None,
                    added: None,
                    updated: None,
                    removed: None,
                    errors: None,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Scan failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details("Scan failed", e.to_string())),
            )
                .into_response()
        }
    }
}

/// Scan status response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanStatusResponse {
    pub scanning: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<ScanProgress>,
}

/// Progress information for an ongoing scan.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanProgress {
    pub scanned: u64,
    pub total: Option<u64>,
    pub current_folder: Option<String>,
}

/// Get the current scan status.
///
/// Currently returns a placeholder response. In the future, this will
/// support async scanning with progress tracking.
pub async fn scan_status(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    // TODO: Implement async scanning with status tracking
    Json(ScanStatusResponse {
        scanning: false,
        progress: None,
    })
}
