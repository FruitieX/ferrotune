//! Library scanning endpoints.

use super::scan_state::ScanProgressUpdate;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
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

    /// If true, perform EBU R128 loudness analysis to compute ReplayGain values.
    /// This is CPU-intensive as it requires fully decoding each audio file.
    #[serde(default)]
    pub analyze_replaygain: bool,

    /// If true, perform bliss audio analysis to compute song similarity features.
    /// This is CPU-intensive as it requires fully decoding each audio file.
    #[serde(default)]
    pub analyze_bliss: bool,

    /// If true, compute waveform data for visualization.
    /// When combined with ReplayGain, both share a single decode pass.
    #[serde(default)]
    pub analyze_waveform: bool,

    /// Number of files to skip in the extraction phase (for debugging).
    #[serde(default)]
    pub skip: Option<u64>,
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
) -> FerrotuneApiResult<impl IntoResponse> {
    let mode = if request.dry_run {
        "dry-run"
    } else if request.full {
        "full"
    } else {
        "incremental"
    };

    // Try to start the scan
    if !state.scan_state.start(mode.to_string()).await {
        return Err(Error::Conflict("A scan is already in progress".to_string()).into());
    }

    tracing::info!(
        "Starting {} scan via API (folder_id: {:?})",
        mode,
        request.folder_id
    );

    // Clone what we need for the async task
    let pool = state.pool.clone();
    let scan_state = state.scan_state.clone();

    let opts = crate::scanner::ScanOptions {
        full: request.full,
        folder_id: request.folder_id,
        dry_run: request.dry_run,
        analyze_replaygain: request.analyze_replaygain,
        analyze_bliss: request.analyze_bliss,
        analyze_waveform: request.analyze_waveform,
        skip: request.skip,
    };

    // Spawn the scan in a background task
    tokio::spawn(async move {
        scan_state.log("INFO", "Starting library scan...").await;
        if opts.analyze_replaygain {
            scan_state
                .log("INFO", "ReplayGain analysis enabled (EBU R128)")
                .await;
        }
        if opts.analyze_bliss {
            scan_state
                .log("INFO", "Bliss audio analysis enabled (song similarity)")
                .await;
        }
        if opts.analyze_waveform {
            scan_state.log("INFO", "Waveform analysis enabled").await;
        }

        match crate::scanner::scan_library_with_progress(&pool, opts, Some(scan_state.clone()))
            .await
        {
            Ok(()) => {
                scan_state
                    .log("INFO", "Library scan completed successfully")
                    .await;
                scan_state.complete().await;
            }
            Err(e) => {
                let error_msg = e.to_string();
                // Check if this was a user-initiated cancellation
                if error_msg.contains("Scan cancelled") {
                    // Cancellation is not an error - complete normally
                    scan_state.complete().await;
                } else {
                    let error_msg = format!("Scan failed: {}", e);
                    tracing::error!("{}", error_msg);
                    scan_state.log("ERROR", &error_msg).await;
                    scan_state.fail(error_msg).await;
                }
            }
        }
    });

    // Return immediately with acknowledgement
    let message = format!("{} scan started", mode);
    Ok((
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
    ))
}

/// Cancel an in-progress scan.
pub async fn cancel_scan(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<impl IntoResponse> {
    if !state.scan_state.is_scanning() {
        return Err(Error::NotFound("No scan is currently in progress".to_string()).into());
    }

    state.scan_state.cancel().await;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "cancelled",
            "message": "Scan cancellation requested"
        })),
    ))
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
pub async fn scan_status(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let progress = state.scan_state.get_progress().await;

    Ok(Json(ScanStatusResponse {
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
    }))
}

/// Stream scan progress updates via Server-Sent Events.
pub async fn scan_progress_stream(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
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

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

/// Response with scan logs.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanLogsResponse {
    pub logs: Vec<super::scan_state::ScanLogEntry>,
}

/// Get recent scan logs.
pub async fn scan_logs(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let logs = state.scan_state.get_logs().await;
    Ok(Json(ScanLogsResponse { logs }))
}

/// Full scan progress response (combines status and logs).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FullScanStatusResponse {
    #[serde(flatten)]
    pub progress: ScanProgressUpdate,
}

/// Get full scan status including progress and logs.
pub async fn full_scan_status(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let progress = state.scan_state.get_progress().await;

    Ok(Json(FullScanStatusResponse { progress }))
}

/// Get scan details (lists of affected files).
pub async fn scan_details(
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let details = state.scan_state.get_details().await;
    Ok(Json(details))
}
