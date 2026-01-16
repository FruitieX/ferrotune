//! File system browsing endpoint for setup and admin purposes.
//!
//! This module provides endpoints for browsing the server's file system to help
//! users select music folder paths during setup.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::error::{Error, FerrotuneApiResult};
use axum::extract::Query;
use axum::response::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

/// Query parameters for browsing directories
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BrowseFilesystemParams {
    /// Path to browse. If not provided, returns common root directories.
    pub path: Option<String>,
}

/// Response for directory listing
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BrowseFilesystemResponse {
    /// Current path being browsed
    pub path: String,
    /// Parent directory path (null if at root level)
    pub parent: Option<String>,
    /// List of directories in the current path
    pub directories: Vec<DirectoryEntry>,
    /// Breadcrumb trail from root to current path
    pub breadcrumbs: Vec<BreadcrumbEntry>,
}

/// A directory entry in the filesystem browser
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DirectoryEntry {
    /// Name of the directory
    pub name: String,
    /// Full path to the directory
    pub path: String,
    /// Whether this directory can be read (has permission)
    pub readable: bool,
}

/// A breadcrumb entry for path navigation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BreadcrumbEntry {
    /// Display name for this path segment
    pub name: String,
    /// Full path to this location
    pub path: String,
}

/// Validate that a path exists and is a directory
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ValidatePathParams {
    /// Path to validate
    pub path: String,
}

/// Response for path validation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ValidatePathResponse {
    /// Whether the path is valid
    pub valid: bool,
    /// Whether the path exists
    pub exists: bool,
    /// Whether the path is a directory
    pub is_directory: bool,
    /// Whether the directory is readable
    pub readable: bool,
    /// Error message if validation failed
    pub error: Option<String>,
}

/// GET /ferrotune/filesystem - Browse the server's filesystem
///
/// This endpoint allows browsing directories on the server to help users
/// select music folder paths during setup. It only shows directories,
/// not files, and requires admin authentication.
pub async fn browse_filesystem(
    user: FerrotuneAuthenticatedUser,
    Query(params): Query<BrowseFilesystemParams>,
) -> FerrotuneApiResult<Json<BrowseFilesystemResponse>> {
    // Only allow admins to browse the filesystem
    if !user.is_admin {
        return Err(
            Error::Forbidden("Only administrators can browse the filesystem".to_string()).into(),
        );
    }

    let path_str = params.path.as_deref().unwrap_or("");

    // If no path provided or empty path, return common root directories
    if path_str.is_empty() {
        return Ok(Json(browse_roots()?));
    }

    let path = PathBuf::from(path_str);

    // Validate the path exists and is a directory
    if !path.exists() {
        return Err(Error::InvalidRequest(format!("Path does not exist: {}", path_str)).into());
    }

    if !path.is_dir() {
        return Err(Error::InvalidRequest(format!("Path is not a directory: {}", path_str)).into());
    }

    // Read directory contents
    let mut directories = Vec::new();

    match std::fs::read_dir(&path) {
        Ok(entries) => {
            for entry in entries.filter_map(|e| e.ok()) {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();

                    // Skip hidden directories (starting with .)
                    if name.starts_with('.') {
                        continue;
                    }

                    // Check if we can read this directory
                    let readable = std::fs::read_dir(&entry_path).is_ok();

                    directories.push(DirectoryEntry {
                        name,
                        path: entry_path.to_string_lossy().to_string(),
                        readable,
                    });
                }
            }
        }
        Err(e) => {
            return Err(Error::InvalidRequest(format!("Cannot read directory: {}", e)).into());
        }
    }

    // Sort directories alphabetically (case-insensitive)
    directories.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Build breadcrumbs
    let breadcrumbs = build_breadcrumbs(&path);

    // Get parent path
    let parent = path.parent().map(|p| p.to_string_lossy().to_string());

    Ok(Json(BrowseFilesystemResponse {
        path: path_str.to_string(),
        parent,
        directories,
        breadcrumbs,
    }))
}

/// GET /ferrotune/filesystem/validate - Validate a filesystem path
///
/// Checks if a path exists, is a directory, and is readable.
pub async fn validate_path(
    user: FerrotuneAuthenticatedUser,
    Query(params): Query<ValidatePathParams>,
) -> FerrotuneApiResult<Json<ValidatePathResponse>> {
    // Only allow admins to validate paths
    if !user.is_admin {
        return Err(Error::Forbidden("Only administrators can validate paths".to_string()).into());
    }

    let path = PathBuf::from(&params.path);

    // Check if path exists
    if !path.exists() {
        return Ok(Json(ValidatePathResponse {
            valid: false,
            exists: false,
            is_directory: false,
            readable: false,
            error: Some("Path does not exist".to_string()),
        }));
    }

    // Check if path is a directory
    if !path.is_dir() {
        return Ok(Json(ValidatePathResponse {
            valid: false,
            exists: true,
            is_directory: false,
            readable: false,
            error: Some("Path is not a directory".to_string()),
        }));
    }

    // Check if path is readable
    let readable = std::fs::read_dir(&path).is_ok();
    if !readable {
        return Ok(Json(ValidatePathResponse {
            valid: false,
            exists: true,
            is_directory: true,
            readable: false,
            error: Some("Directory is not readable (permission denied)".to_string()),
        }));
    }

    Ok(Json(ValidatePathResponse {
        valid: true,
        exists: true,
        is_directory: true,
        readable: true,
        error: None,
    }))
}

/// Build breadcrumb trail from root to the given path
fn build_breadcrumbs(path: &std::path::Path) -> Vec<BreadcrumbEntry> {
    let mut breadcrumbs = Vec::new();
    let mut current = PathBuf::new();

    for component in path.components() {
        current.push(component);
        let name = match component {
            std::path::Component::RootDir => "/".to_string(),
            std::path::Component::Normal(s) => s.to_string_lossy().to_string(),
            std::path::Component::Prefix(p) => p.as_os_str().to_string_lossy().to_string(),
            _ => continue,
        };

        breadcrumbs.push(BreadcrumbEntry {
            name,
            path: current.to_string_lossy().to_string(),
        });
    }

    breadcrumbs
}

/// Get common root directories for browsing
fn browse_roots() -> FerrotuneApiResult<BrowseFilesystemResponse> {
    let mut directories = Vec::new();

    // On Unix systems, just return the root directory
    #[cfg(unix)]
    {
        // Root directory
        if std::path::Path::new("/").is_dir() {
            directories.push(DirectoryEntry {
                name: "/".to_string(),
                path: "/".to_string(),
                readable: std::fs::read_dir("/").is_ok(),
            });
        }
    }

    // On Windows, list available drives
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let path = std::path::Path::new(&drive);
            if path.is_dir() {
                directories.push(DirectoryEntry {
                    name: format!("{} Drive", letter as char),
                    path: drive.clone(),
                    readable: std::fs::read_dir(&drive).is_ok(),
                });
            }
        }
    }

    Ok(BrowseFilesystemResponse {
        path: String::new(),
        parent: None,
        directories,
        breadcrumbs: Vec::new(),
    })
}
