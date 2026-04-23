//! User management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow admin users to manage other users:
//! - Create new users
//! - Update user details (password, email, admin status)
//! - Delete users
//! - Manage library access (which music folders a user can see)
//! - Manage API keys

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::users as users_repo;
use crate::error::{Error, FerrotuneApiResult};
use crate::password;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Types
// ============================================================================

/// User info response (without sensitive data like password)
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UserInfo {
    #[ts(type = "number")]
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub is_admin: bool,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    /// Music folder IDs this user has access to
    #[ts(type = "number[]")]
    pub library_access: Vec<i64>,
}

/// Response containing a list of users
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UsersResponse {
    pub users: Vec<UserInfo>,
}

/// Request to create a new user
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    #[serde(default)]
    pub is_admin: bool,
    /// Music folder IDs to grant access to. If empty, grants access to all folders.
    #[ts(type = "number[]")]
    #[serde(default)]
    pub library_access: Vec<i64>,
}

/// Request to update an existing user
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    pub password: Option<String>,
    pub email: Option<String>,
    pub is_admin: Option<bool>,
    /// If provided, replaces the user's library access. Use None to keep current access.
    #[ts(type = "number[] | null")]
    pub library_access: Option<Vec<i64>>,
}

/// Response after creating a user
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateUserResponse {
    #[ts(type = "number")]
    pub id: i64,
    pub username: String,
}

/// API key info response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ApiKeyInfo {
    /// The token is only shown when creating a new key
    pub token: Option<String>,
    pub name: String,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string | null")]
    pub last_used: Option<DateTime<Utc>>,
}

/// Request to create a new API key
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateApiKeyRequest {
    pub name: String,
}

/// Response after creating an API key
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateApiKeyResponse {
    /// The API key - only shown once when creating
    pub key: String,
    pub name: String,
}

/// Response for library access
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LibraryAccessResponse {
    #[ts(type = "number")]
    pub user_id: i64,
    #[ts(type = "number[]")]
    pub folder_ids: Vec<i64>,
}

/// Request to update library access
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SetLibraryAccessRequest {
    #[ts(type = "number[]")]
    pub folder_ids: Vec<i64>,
}

/// Response containing API keys
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ApiKeysResponse {
    pub api_keys: Vec<ApiKeyInfo>,
}

/// Minimal user info for sharing UI (available to all authenticated users)
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShareableUser {
    #[ts(type = "number")]
    pub id: i64,
    pub username: String,
}

/// Response containing shareable users
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShareableUsersResponse {
    pub users: Vec<ShareableUser>,
}

// ============================================================================
// Helper: Check admin permission
// ============================================================================

pub(crate) fn require_admin(user: &FerrotuneAuthenticatedUser) -> FerrotuneApiResult<()> {
    if !user.is_admin {
        return Err(Error::Auth("Admin privileges required".to_string()).into());
    }
    Ok(())
}

// ============================================================================
// User CRUD Endpoints
// ============================================================================

/// GET /ferrotune/users/shareable - List users available for sharing (any authenticated user)
pub async fn list_shareable_users(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ShareableUsersResponse>> {
    let users = users_repo::list_shareable_users(&state.database, user.user_id)
        .await?
        .into_iter()
        .map(|(id, username)| ShareableUser { id, username })
        .collect();

    Ok(Json(ShareableUsersResponse { users }))
}

/// GET /ferrotune/users/me - Get current user info (any authenticated user)
pub async fn get_current_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<UserInfo>> {
    // Fetch the full user record from database to get all fields
    let u = users_repo::get_user_by_id(&state.database, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", user.user_id)))?;

    let library_access =
        users_repo::get_user_library_access_ids(&state.database, user.user_id).await?;

    Ok(Json(UserInfo {
        id: u.id,
        username: u.username,
        email: u.email,
        is_admin: u.is_admin,
        created_at: u.created_at,
        library_access,
    }))
}

/// GET /ferrotune/users - List all users (admin only)
pub async fn list_users(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<UsersResponse>> {
    require_admin(&user)?;

    let users = users_repo::list_users(&state.database).await?;

    let mut user_infos = Vec::with_capacity(users.len());
    for u in users {
        let library_access = users_repo::get_user_library_access_ids(&state.database, u.id).await?;
        user_infos.push(UserInfo {
            id: u.id,
            username: u.username,
            email: u.email,
            is_admin: u.is_admin,
            created_at: u.created_at,
            library_access,
        });
    }

    Ok(Json(UsersResponse { users: user_infos }))
}

/// GET /ferrotune/users/{id} - Get a specific user (admin only)
pub async fn get_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<Json<UserInfo>> {
    require_admin(&user)?;

    let u = users_repo::get_user_by_id(&state.database, id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", id)))?;

    let library_access = users_repo::get_user_library_access_ids(&state.database, u.id).await?;

    Ok(Json(UserInfo {
        id: u.id,
        username: u.username,
        email: u.email,
        is_admin: u.is_admin,
        created_at: u.created_at,
        library_access,
    }))
}

/// POST /ferrotune/users - Create a new user (admin only)
pub async fn create_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateUserRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Validate username
    if request.username.is_empty() {
        return Err(Error::InvalidRequest("Username cannot be empty".to_string()).into());
    }
    if request.username.len() < 3 {
        return Err(
            Error::InvalidRequest("Username must be at least 3 characters".to_string()).into(),
        );
    }

    // Check if username already exists
    if users_repo::username_exists(&state.database, &request.username, None).await? {
        return Err(Error::InvalidRequest(format!(
            "Username '{}' is already taken",
            request.username
        ))
        .into());
    }

    // Hash the password using argon2
    let password_hash = password::hash_password(&request.password)
        .map_err(|e| Error::Internal(format!("Failed to hash password: {}", e)))?;
    // Create subsonic token for legacy token+salt authentication
    let subsonic_token = password::create_subsonic_token(&request.password);

    // Create the user with hashed password
    let user_id = users_repo::create_user(
        &state.database,
        &request.username,
        &password_hash,
        &subsonic_token,
        request.email.as_deref(),
        request.is_admin,
    )
    .await?;

    // Set up library access
    let folder_ids = if request.library_access.is_empty() {
        // Grant access to all folders by default
        users_repo::get_music_folder_ids(&state.database).await?
    } else {
        request.library_access
    };

    users_repo::replace_user_library_access(&state.database, user_id, &folder_ids).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateUserResponse {
            id: user_id,
            username: request.username,
        }),
    ))
}

/// PATCH /ferrotune/users/{id} - Update a user (admin only)
pub async fn update_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<UpdateUserRequest>,
) -> FerrotuneApiResult<Json<UserInfo>> {
    require_admin(&user)?;

    // Check if user exists
    if users_repo::get_user_by_id(&state.database, id)
        .await?
        .is_none()
    {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    if let Some(username) = &request.username {
        if username.len() < 3 {
            return Err(Error::InvalidRequest(
                "Username must be at least 3 characters".to_string(),
            )
            .into());
        }
        // Check if username is taken by another user
        if users_repo::username_exists(&state.database, username, Some(id)).await? {
            return Err(
                Error::InvalidRequest(format!("Username '{}' is already taken", username)).into(),
            );
        }
        users_repo::update_user_username_by_id(&state.database, id, username).await?;
    }

    // Handle password update specially - need to hash it
    if let Some(password) = &request.password {
        // Hash the password using argon2
        let password_hash = password::hash_password(password)
            .map_err(|e| Error::Internal(format!("Failed to hash password: {}", e)))?;
        // Create subsonic token for legacy token+salt authentication
        let subsonic_token = password::create_subsonic_token(password);

        // Update both password_hash and subsonic_token
        users_repo::update_user_password_by_id(
            &state.database,
            id,
            &password_hash,
            &subsonic_token,
        )
        .await?;
    }

    if let Some(email) = &request.email {
        users_repo::update_user_email_by_id(&state.database, id, Some(email.as_str())).await?;
    }

    if let Some(is_admin) = request.is_admin {
        // Prevent removing admin from self
        if id == user.user_id && !is_admin {
            return Err(Error::InvalidRequest(
                "Cannot remove your own admin privileges".to_string(),
            )
            .into());
        }
        users_repo::update_user_admin_by_id(&state.database, id, is_admin).await?;
    }

    // Update library access if provided
    if let Some(folder_ids) = request.library_access {
        users_repo::replace_user_library_access(&state.database, id, &folder_ids).await?;
    }

    // Return updated user info
    let u = users_repo::get_user_by_id(&state.database, id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", id)))?;

    let library_access = users_repo::get_user_library_access_ids(&state.database, u.id).await?;

    Ok(Json(UserInfo {
        id: u.id,
        username: u.username,
        email: u.email,
        is_admin: u.is_admin,
        created_at: u.created_at,
        library_access,
    }))
}

/// DELETE /ferrotune/users/{id} - Delete a user (admin only)
pub async fn delete_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<impl IntoResponse> {
    require_admin(&user)?;

    // Prevent deleting self
    if id == user.user_id {
        return Err(Error::InvalidRequest("Cannot delete yourself".to_string()).into());
    }

    // Check if user exists
    if !users_repo::user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Delete the user (cascades to api_keys, user_library_access, playlists, etc.)
    users_repo::delete_user_by_id(&state.database, id).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Library Access Endpoints
// ============================================================================

/// GET /ferrotune/users/{id}/library-access - Get user's library access
pub async fn get_library_access(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<Json<LibraryAccessResponse>> {
    require_admin(&user)?;

    // Check if user exists
    if !users_repo::user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    let access = users_repo::get_user_library_access_ids(&state.database, id).await?;
    Ok(Json(LibraryAccessResponse {
        user_id: id,
        folder_ids: access,
    }))
}

/// PUT /ferrotune/users/{id}/library-access - Set user's library access
pub async fn set_library_access(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<SetLibraryAccessRequest>,
) -> FerrotuneApiResult<Json<LibraryAccessResponse>> {
    require_admin(&user)?;

    // Check if user exists
    if !users_repo::user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Replace existing access
    users_repo::replace_user_library_access(&state.database, id, &request.folder_ids).await?;

    Ok(Json(LibraryAccessResponse {
        user_id: id,
        folder_ids: request.folder_ids,
    }))
}

// ============================================================================
// API Key Endpoints
// ============================================================================

/// GET /ferrotune/users/{id}/api-keys - List user's API keys (admin or self)
pub async fn list_api_keys(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> FerrotuneApiResult<Json<ApiKeysResponse>> {
    // Allow users to view their own keys, or admin can view anyone's
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if user exists
    if !users_repo::user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    let keys = users_repo::list_api_keys(&state.database, id).await?;

    let key_infos: Vec<ApiKeyInfo> = keys
        .into_iter()
        .map(|(name, created_at, last_used)| ApiKeyInfo {
            token: None, // Don't expose existing tokens
            name,
            created_at,
            last_used,
        })
        .collect();

    Ok(Json(ApiKeysResponse {
        api_keys: key_infos,
    }))
}

/// POST /ferrotune/users/{id}/api-keys - Create a new API key (admin or self)
pub async fn create_api_key(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<CreateApiKeyRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    // Allow users to create their own keys, or admin can create for anyone
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if user exists
    if !users_repo::user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Generate a secure random token
    let token = generate_api_key();

    // Create the key
    users_repo::create_api_key(&state.database, &token, id, &request.name).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateApiKeyResponse {
            key: token,
            name: request.name,
        }),
    ))
}

/// DELETE /ferrotune/users/{id}/api-keys/{name} - Delete an API key (admin or self)
pub async fn delete_api_key(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(i64, String)>,
) -> FerrotuneApiResult<impl IntoResponse> {
    // Allow users to delete their own keys, or admin can delete anyone's
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if key exists
    if !users_repo::api_key_exists(&state.database, id, &name).await? {
        return Err(
            Error::NotFound(format!("API key '{}' not found for user {}", name, id)).into(),
        );
    }

    users_repo::delete_api_key(&state.database, id, &name).await?;

    Ok(StatusCode::NO_CONTENT)
}

fn generate_api_key() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

// ============================================================================
// Library Access Check (for use in other modules)
// ============================================================================

/// Check if a user has access to a specific music folder
#[allow(dead_code)]
pub async fn user_has_folder_access(
    database: &crate::db::Database,
    user_id: i64,
    folder_id: i64,
) -> FerrotuneApiResult<bool> {
    users_repo::user_has_folder_access(database, user_id, folder_id)
        .await
        .map_err(Into::into)
}

/// Check if a user has access to a specific song
pub async fn user_has_song_access(
    database: &crate::db::Database,
    user_id: i64,
    song_id: &str,
) -> FerrotuneApiResult<bool> {
    users_repo::user_has_song_access(database, user_id, song_id)
        .await
        .map_err(Into::into)
}

/// Get the list of music folder IDs a user has access to
#[allow(dead_code)]
pub async fn get_user_accessible_folders(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<Vec<i64>> {
    users_repo::get_user_library_access_ids(database, user_id)
        .await
        .map_err(Into::into)
}
