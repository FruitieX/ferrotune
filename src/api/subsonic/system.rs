use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use axum::extract::State;
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

pub async fn ping(user: AuthenticatedUser) -> impl axum::response::IntoResponse {
    format_ok_empty(user.format)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct License {
    pub valid: bool,
    pub email: String,
    pub license_expires: String,
}

pub async fn get_license(user: AuthenticatedUser) -> FormatResponse<License> {
    let response = License {
        valid: true,
        email: "opensource@ferrotune.org".to_string(),
        license_expires: "2099-12-31T00:00:00".to_string(),
    };
    FormatResponse::new(user.format, response)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct OpenSubsonicExtensions {
    pub open_subsonic_extensions: Vec<OpenSubsonicExtension>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct OpenSubsonicExtension {
    pub name: String,
    pub versions: Vec<i32>,
}

pub async fn get_opensubsonic_extensions(
    user: AuthenticatedUser,
) -> FormatResponse<OpenSubsonicExtensions> {
    let response = OpenSubsonicExtensions {
        open_subsonic_extensions: vec![
            OpenSubsonicExtension {
                name: "apiKeyAuthentication".to_string(),
                versions: vec![1],
            },
            // Full transcoding extension (getTranscodeDecision + getTranscodeStream)
            OpenSubsonicExtension {
                name: "transcoding".to_string(),
                versions: vec![1],
            },
            // timeOffset support in /rest/stream endpoint
            OpenSubsonicExtension {
                name: "transcodeOffset".to_string(),
                versions: vec![1],
            },
        ],
    };
    FormatResponse::new(user.format, response)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFolders {
    pub music_folders: MusicFoldersInner,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFoldersInner {
    pub music_folder: Vec<MusicFolderResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MusicFolderResponse {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
}

pub async fn get_music_folders(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<MusicFolders>> {
    let folders =
        crate::db::queries::get_music_folders_for_user(&state.database, user.user_id).await?;

    let response = MusicFolders {
        music_folders: MusicFoldersInner {
            music_folder: folders
                .into_iter()
                .map(|f| MusicFolderResponse {
                    id: f.id,
                    name: f.name,
                })
                .collect(),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// Scan status types (Subsonic API: startScan / getScanStatus)

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanStatusWrapper {
    pub scan_status: ScanStatusInner,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ScanStatusInner {
    pub scanning: bool,
    #[ts(type = "number")]
    pub count: u64,
}

/// Subsonic-compatible startScan endpoint.
///
/// Triggers a library scan and returns the current scan status.
pub async fn start_scan(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<ScanStatusWrapper>> {
    // Start an incremental scan (Subsonic spec doesn't expose full/dry-run options)
    let started = state.scan_state.start("incremental".to_string()).await;

    if started {
        let database = state.database.clone();
        let scan_state = state.scan_state.clone();
        let opts = crate::scanner::ScanOptions {
            full: false,
            folder_id: None,
            dry_run: false,
            analyze_replaygain: false,
            analyze_bliss: false,
            analyze_waveform: false,
            skip: None,
        };
        tokio::spawn(async move {
            scan_state.log("INFO", "Starting library scan...").await;
            match crate::scanner::scan_library_with_progress(
                &database,
                opts,
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
                    let error_msg = e.to_string();
                    if error_msg.contains("Scan cancelled") {
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
    }

    let progress = state.scan_state.get_progress().await;
    let response = ScanStatusWrapper {
        scan_status: ScanStatusInner {
            scanning: progress.scanning,
            count: progress.scanned,
        },
    };
    Ok(FormatResponse::new(user.format, response))
}

/// Subsonic-compatible getScanStatus endpoint.
pub async fn get_scan_status(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<ScanStatusWrapper>> {
    let progress = state.scan_state.get_progress().await;
    let response = ScanStatusWrapper {
        scan_status: ScanStatusInner {
            scanning: progress.scanning,
            count: progress.scanned,
        },
    };
    Ok(FormatResponse::new(user.format, response))
}
