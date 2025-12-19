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
    let folders = crate::db::queries::get_music_folders(&state.pool).await?;

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
