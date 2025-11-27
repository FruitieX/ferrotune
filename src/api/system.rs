use crate::api::auth::AuthenticatedUser;
use crate::api::response::{format_ok_empty, FormatResponse};
use crate::api::xml::{
    XmlExtension, XmlLicenseInner, XmlLicenseResponse, XmlMusicFolder, XmlMusicFoldersInner,
    XmlMusicFoldersResponse, XmlOpenSubsonicExtensionsResponse,
};
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
    valid: bool,
    email: String,
    license_expires: String,
}

pub async fn get_license(user: AuthenticatedUser) -> FormatResponse<License, XmlLicenseResponse> {
    let json = License {
        valid: true,
        email: "opensource@ferrotune.org".to_string(),
        license_expires: "2099-12-31T00:00:00".to_string(),
    };
    let xml = XmlLicenseResponse::ok(XmlLicenseInner {
        valid: true,
        email: "opensource@ferrotune.org".to_string(),
        license_expires: "2099-12-31T00:00:00".to_string(),
    });
    FormatResponse::new(user.format, json, xml)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSubsonicExtensions {
    open_subsonic_extensions: Vec<OpenSubsonicExtension>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSubsonicExtension {
    name: String,
    versions: Vec<i32>,
}

pub async fn get_opensubsonic_extensions(
    user: AuthenticatedUser,
) -> FormatResponse<OpenSubsonicExtensions, XmlOpenSubsonicExtensionsResponse> {
    let json = OpenSubsonicExtensions {
        open_subsonic_extensions: vec![OpenSubsonicExtension {
            name: "apiKeyAuthentication".to_string(),
            versions: vec![1],
        }],
    };
    let xml = XmlOpenSubsonicExtensionsResponse::ok(vec![XmlExtension {
        name: "apiKeyAuthentication".to_string(),
        versions: "1".to_string(),
    }]);
    FormatResponse::new(user.format, json, xml)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolders {
    music_folders: MusicFoldersInner,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFoldersInner {
    music_folder: Vec<MusicFolderResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolderResponse {
    id: i64,
    name: String,
}

pub async fn get_music_folders(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<MusicFolders, XmlMusicFoldersResponse>> {
    let folders = crate::db::queries::get_music_folders(&state.pool).await?;

    let json = MusicFolders {
        music_folders: MusicFoldersInner {
            music_folder: folders
                .iter()
                .map(|f| MusicFolderResponse {
                    id: f.id,
                    name: f.name.clone(),
                })
                .collect(),
        },
    };

    let xml = XmlMusicFoldersResponse::ok(XmlMusicFoldersInner {
        music_folder: folders
            .into_iter()
            .map(|f| XmlMusicFolder {
                id: f.id,
                name: f.name,
            })
            .collect(),
    });

    Ok(FormatResponse::new(user.format, json, xml))
}
