use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use axum::extract::State;
use serde::Serialize;
use std::sync::Arc;

pub async fn ping(user: AuthenticatedUser) -> impl axum::response::IntoResponse {
    format_ok_empty(user.format)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSubsonicExtensions {
    pub open_subsonic_extensions: Vec<OpenSubsonicExtension>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSubsonicExtension {
    pub name: String,
    pub versions: Vec<i32>,
}

pub async fn get_opensubsonic_extensions(
    user: AuthenticatedUser,
) -> FormatResponse<OpenSubsonicExtensions> {
    let response = OpenSubsonicExtensions {
        open_subsonic_extensions: vec![OpenSubsonicExtension {
            name: "apiKeyAuthentication".to_string(),
            versions: vec![1],
        }],
    };
    FormatResponse::new(user.format, response)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolders {
    pub music_folders: MusicFoldersInner,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFoldersInner {
    pub music_folder: Vec<MusicFolderResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolderResponse {
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
