//! Library scanning endpoints.

use super::scan_state::ScanProgressUpdate;
use crate::api::ferrotune::ErrorResponse;
use crate::api::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse, Json,
    },
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::Arc, time::Duration};
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
    #[ts(type = "number | null")]
    pub scanned: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub added: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub updated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub removed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub errors: Option<u64>,
}

/// Start a library scan.
///
/// This endpoint triggers an async library scan. The scan runs in the background
/// and progress can be monitored via the /scan/progress SSE endpoint.
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

    // Try to start the scan
    if !state.scan_state.start(mode.to_string()).await {
        return (
            StatusCode::CONFLICT,
            Json(ErrorResponse::new("A scan is already in progress")),
        )
            .into_response();
    }

    tracing::info!(
        "Starting {} scan via API (folder_id: {:?})",
        mode,
        request.folder_id
    );

    // Clone what we need for the async task
    let pool = state.pool.clone();
    let config = state.config.clone();
    let scan_state = state.scan_state.clone();
    let full = request.full;
    let folder_id = request.folder_id;
    let dry_run = request.dry_run;

    // Spawn the scan in a background task
    tokio::spawn(async move {
        scan_state.log("INFO", "Starting library scan...").await;

        match crate::scanner::scan_library_with_progress(
            &pool,
            &config,
            full,
            folder_id,
            dry_run,
            Some(scan_state.clone()),
        )
        .await
        {
            Ok(()) => {
                scan_state
                    .log("INFO", "Library scan completed successfully")
                    .await;
                scan_state.complete().await;
            }
            Err(e) => {
                let error_msg = format!("Scan failed: {}", e);
                tracing::error!("{}", error_msg);
                scan_state.log("ERROR", &error_msg).await;
                scan_state.fail(error_msg).await;
            }
        }
    });

    // Return immediately with acknowledgement
    let message = format!("{} scan started", mode);
    (
        StatusCode::ACCEPTED,
        Json(ScanResponse {
            status: "started",
            message,
            scanned: None,
            added: None,
            updated: None,
            removed: None,
            errors: None,
        }),
    )
        .into_response()
}

/// Cancel an in-progress scan.
pub async fn cancel_scan(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if !state.scan_state.is_scanning() {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new("No scan is currently in progress")),
        )
            .into_response();
    }

    state.scan_state.cancel().await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "cancelled",
            "message": "Scan cancellation requested"
        })),
    )
        .into_response()
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
    #[ts(type = "number")]
    pub scanned: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
    pub current_folder: Option<String>,
}

/// Get the current scan status.
pub async fn scan_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let progress = state.scan_state.get_progress().await;

    Json(ScanStatusResponse {
        scanning: progress.scanning,
        progress: if progress.scanning || progress.finished {
            Some(ScanProgress {
                scanned: progress.scanned,
                total: progress.total,
                current_folder: progress.current_folder,
            })
        } else {
            None
        },
    })
}

/// Stream scan progress updates via Server-Sent Events.
pub async fn scan_progress_stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Get a receiver for progress updates
    let mut rx = state.scan_state.subscribe();

    // Send initial state immediately
    let initial = state.scan_state.get_progress().await;

    let stream = async_stream::stream! {
        // Send initial state
        if let Ok(json) = serde_json::to_string(&initial) {
            yield Ok(Event::default().data(json));
        }

        // Stream updates
        loop {
            match rx.recv().await {
                Ok(update) => {
                    if let Ok(json) = serde_json::to_string(&update) {
                        yield Ok(Event::default().data(json));
                    }

                    // Stop streaming if scan is finished
                    if update.finished {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Missed some updates, continue
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    // Channel closed, stop
                    break;
                }
            }
        }
    };

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

/// Response with scan logs.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanLogsResponse {
    pub logs: Vec<super::scan_state::ScanLogEntry>,
}

/// Get recent scan logs.
pub async fn scan_logs(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let logs = state.scan_state.get_logs().await;
    Json(ScanLogsResponse { logs })
}

/// Full scan progress response (combines status and logs).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FullScanStatusResponse {
    #[serde(flatten)]
    pub progress: ScanProgressUpdate,
    pub logs: Vec<super::scan_state::ScanLogEntry>,
}

/// Get full scan status including progress and logs.
pub async fn full_scan_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let progress = state.scan_state.get_progress().await;
    let logs = state.scan_state.get_logs().await;

    Json(FullScanStatusResponse { progress, logs })
}

/// Get scan details (lists of affected files).
pub async fn scan_details(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let details = state.scan_state.get_details().await;
    Json(details)
}
