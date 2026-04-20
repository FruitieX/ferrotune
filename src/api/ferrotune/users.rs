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
use crate::db::models::User;
use crate::error::{Error, FerrotuneApiResult};
use crate::password;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use sea_orm::{FromQueryResult, Value};
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
#[derive(Debug, Serialize, FromQueryResult, TS)]
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

#[derive(Debug, FromQueryResult)]
struct FolderAccessRow {
    music_folder_id: i64,
}

#[derive(Debug, FromQueryResult)]
struct IdRow {
    id: i64,
}

#[derive(Debug, FromQueryResult)]
struct ApiKeySummaryRow {
    name: String,
    created_at: DateTime<Utc>,
    last_used: Option<DateTime<Utc>>,
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
    let users = list_shareable_users_db(&state.database, user.user_id).await?;

    Ok(Json(ShareableUsersResponse { users }))
}

/// GET /ferrotune/users/me - Get current user info (any authenticated user)
pub async fn get_current_user(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<UserInfo>> {
    // Fetch the full user record from database to get all fields
    let u = fetch_user_by_id(&state.database, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", user.user_id)))?;

    let library_access = get_user_library_access(&state.database, user.user_id).await?;

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

    let users = list_users_db(&state.database).await?;

    let mut user_infos = Vec::with_capacity(users.len());
    for u in users {
        let library_access = get_user_library_access(&state.database, u.id).await?;
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

    let u = fetch_user_by_id(&state.database, id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", id)))?;

    let library_access = get_user_library_access(&state.database, u.id).await?;

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
    if username_exists(&state.database, &request.username, None).await? {
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
    let user_id = insert_user_db(
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
        list_music_folder_ids_db(&state.database).await?
    } else {
        request.library_access
    };

    for folder_id in &folder_ids {
        grant_user_library_access(&state.database, user_id, *folder_id).await?;
    }

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
    if fetch_user_by_id(&state.database, id).await?.is_none() {
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
        if username_exists(&state.database, username, Some(id)).await? {
            return Err(
                Error::InvalidRequest(format!("Username '{}' is already taken", username)).into(),
            );
        }
        update_user_username_db(&state.database, id, username).await?;
    }

    // Handle password update specially - need to hash it
    if let Some(password) = &request.password {
        // Hash the password using argon2
        let password_hash = password::hash_password(password)
            .map_err(|e| Error::Internal(format!("Failed to hash password: {}", e)))?;
        // Create subsonic token for legacy token+salt authentication
        let subsonic_token = password::create_subsonic_token(password);

        // Update both password_hash and subsonic_token
        update_user_password_db(&state.database, id, &password_hash, &subsonic_token).await?;
    }

    if let Some(email) = &request.email {
        update_user_email_db(&state.database, id, Some(email.as_str())).await?;
    }

    if let Some(is_admin) = request.is_admin {
        // Prevent removing admin from self
        if id == user.user_id && !is_admin {
            return Err(Error::InvalidRequest(
                "Cannot remove your own admin privileges".to_string(),
            )
            .into());
        }
        update_user_admin_db(&state.database, id, is_admin).await?;
    }

    // Update library access if provided
    if let Some(folder_ids) = request.library_access {
        replace_user_library_access(&state.database, id, &folder_ids).await?;
    }

    // Return updated user info
    let u = fetch_user_by_id(&state.database, id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", id)))?;

    let library_access = get_user_library_access(&state.database, u.id).await?;

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
    if !user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Delete the user (cascades to api_keys, user_library_access, playlists, etc.)
    delete_user_db(&state.database, id).await?;

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
    if !user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    let access = get_user_library_access(&state.database, id).await?;
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
    if !user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Replace existing access
    replace_user_library_access(&state.database, id, &request.folder_ids).await?;

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
    if !user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    let keys = list_api_keys_db(&state.database, id).await?;

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
    if !user_exists(&state.database, id).await? {
        return Err(Error::NotFound(format!("User {} not found", id)).into());
    }

    // Generate a secure random token
    let token = generate_api_key();

    // Create the key
    insert_api_key_db(&state.database, &token, id, &request.name).await?;

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
    if !api_key_exists(&state.database, id, &name).await? {
        return Err(
            Error::NotFound(format!("API key '{}' not found for user {}", name, id)).into(),
        );
    }

    delete_api_key_db(&state.database, id, &name).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Helper Functions
// ============================================================================

async fn get_user_library_access(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<Vec<i64>> {
    let access = crate::db::raw::query_all::<FolderAccessRow>(
        database.conn(),
        "SELECT music_folder_id FROM user_library_access WHERE user_id = ?",
        "SELECT music_folder_id FROM user_library_access WHERE user_id = $1",
        [Value::from(user_id)],
    )
    .await?;

    Ok(access.into_iter().map(|row| row.music_folder_id).collect())
}

async fn list_shareable_users_db(
    database: &crate::db::Database,
    exclude_user_id: i64,
) -> FerrotuneApiResult<Vec<ShareableUser>> {
    crate::db::raw::query_all::<ShareableUser>(
        database.conn(),
        "SELECT id, username FROM users WHERE id != ? ORDER BY username COLLATE NOCASE",
        "SELECT id, username FROM users WHERE id != $1 ORDER BY LOWER(username)",
        [Value::from(exclude_user_id)],
    )
    .await
    .map_err(Into::into)
}

async fn fetch_user_by_id(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<Option<User>> {
    crate::db::raw::query_one::<User>(
        database.conn(),
        "SELECT * FROM users WHERE id = ?",
        "SELECT * FROM users WHERE id = $1",
        [Value::from(user_id)],
    )
    .await
    .map_err(Into::into)
}

async fn list_users_db(database: &crate::db::Database) -> FerrotuneApiResult<Vec<User>> {
    crate::db::raw::query_all::<User>(
        database.conn(),
        "SELECT * FROM users ORDER BY id",
        "SELECT * FROM users ORDER BY id",
        std::iter::empty::<Value>(),
    )
    .await
    .map_err(Into::into)
}

async fn user_exists(database: &crate::db::Database, user_id: i64) -> FerrotuneApiResult<bool> {
    Ok(fetch_user_by_id(database, user_id).await?.is_some())
}

async fn username_exists(
    database: &crate::db::Database,
    username: &str,
    exclude_user_id: Option<i64>,
) -> FerrotuneApiResult<bool> {
    let exists = if let Some(exclude_id) = exclude_user_id {
        crate::db::raw::query_scalar::<i64>(
            database.conn(),
            "SELECT id FROM users WHERE username = ? AND id != ?",
            "SELECT id FROM users WHERE username = $1 AND id != $2",
            [Value::from(username.to_string()), Value::from(exclude_id)],
        )
        .await?
    } else {
        crate::db::raw::query_scalar::<i64>(
            database.conn(),
            "SELECT id FROM users WHERE username = ?",
            "SELECT id FROM users WHERE username = $1",
            [Value::from(username.to_string())],
        )
        .await?
    };

    Ok(exists.is_some())
}

async fn insert_user_db(
    database: &crate::db::Database,
    username: &str,
    password_hash: &str,
    subsonic_token: &str,
    email: Option<&str>,
    is_admin: bool,
) -> FerrotuneApiResult<i64> {
    crate::db::raw::query_scalar::<i64>(
        database.conn(),
        "INSERT INTO users (username, password_hash, subsonic_token, email, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING id",
        "INSERT INTO users (username, password_hash, subsonic_token, email, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [
            Value::from(username.to_string()),
            Value::from(password_hash.to_string()),
            Value::from(subsonic_token.to_string()),
            Value::from(email.map(str::to_string)),
            Value::from(is_admin),
        ],
    )
    .await?
    .ok_or_else(|| Error::Internal("Failed to insert user".to_string()).into())
}

async fn update_user_username_db(
    database: &crate::db::Database,
    user_id: i64,
    username: &str,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "UPDATE users SET username = ? WHERE id = ?",
        "UPDATE users SET username = $1 WHERE id = $2",
        [Value::from(username.to_string()), Value::from(user_id)],
    )
    .await?;
    Ok(())
}

async fn update_user_password_db(
    database: &crate::db::Database,
    user_id: i64,
    password_hash: &str,
    subsonic_token: &str,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "UPDATE users SET password_hash = ?, subsonic_token = ? WHERE id = ?",
        "UPDATE users SET password_hash = $1, subsonic_token = $2 WHERE id = $3",
        [
            Value::from(password_hash.to_string()),
            Value::from(subsonic_token.to_string()),
            Value::from(user_id),
        ],
    )
    .await?;
    Ok(())
}

async fn update_user_email_db(
    database: &crate::db::Database,
    user_id: i64,
    email: Option<&str>,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "UPDATE users SET email = ? WHERE id = ?",
        "UPDATE users SET email = $1 WHERE id = $2",
        [Value::from(email.map(str::to_string)), Value::from(user_id)],
    )
    .await?;
    Ok(())
}

async fn update_user_admin_db(
    database: &crate::db::Database,
    user_id: i64,
    is_admin: bool,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "UPDATE users SET is_admin = ? WHERE id = ?",
        "UPDATE users SET is_admin = $1 WHERE id = $2",
        [Value::from(is_admin), Value::from(user_id)],
    )
    .await?;
    Ok(())
}

async fn delete_user_db(database: &crate::db::Database, user_id: i64) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "DELETE FROM users WHERE id = ?",
        "DELETE FROM users WHERE id = $1",
        [Value::from(user_id)],
    )
    .await?;
    Ok(())
}

async fn list_music_folder_ids_db(database: &crate::db::Database) -> FerrotuneApiResult<Vec<i64>> {
    let folder_ids = crate::db::raw::query_all::<IdRow>(
        database.conn(),
        "SELECT id FROM music_folders ORDER BY id",
        "SELECT id FROM music_folders ORDER BY id",
        std::iter::empty::<Value>(),
    )
    .await?;

    Ok(folder_ids.into_iter().map(|row| row.id).collect())
}

async fn clear_user_library_access(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "DELETE FROM user_library_access WHERE user_id = ?",
        "DELETE FROM user_library_access WHERE user_id = $1",
        [Value::from(user_id)],
    )
    .await?;
    Ok(())
}

async fn grant_user_library_access(
    database: &crate::db::Database,
    user_id: i64,
    folder_id: i64,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
        "INSERT INTO user_library_access (user_id, music_folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [Value::from(user_id), Value::from(folder_id)],
    )
    .await?;
    Ok(())
}

async fn replace_user_library_access(
    database: &crate::db::Database,
    user_id: i64,
    folder_ids: &[i64],
) -> FerrotuneApiResult<()> {
    clear_user_library_access(database, user_id).await?;

    for folder_id in folder_ids {
        grant_user_library_access(database, user_id, *folder_id).await?;
    }

    Ok(())
}

async fn list_api_keys_db(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<Vec<(String, DateTime<Utc>, Option<DateTime<Utc>>)>> {
    let rows = crate::db::raw::query_all::<ApiKeySummaryRow>(
        database.conn(),
        "SELECT name, created_at, last_used FROM api_keys WHERE user_id = ?",
        "SELECT name, created_at, last_used FROM api_keys WHERE user_id = $1",
        [Value::from(user_id)],
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.name, row.created_at, row.last_used))
        .collect())
}

async fn insert_api_key_db(
    database: &crate::db::Database,
    token: &str,
    user_id: i64,
    name: &str,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "INSERT INTO api_keys (token, user_id, name) VALUES (?, ?, ?)",
        "INSERT INTO api_keys (token, user_id, name) VALUES ($1, $2, $3)",
        [
            Value::from(token.to_string()),
            Value::from(user_id),
            Value::from(name.to_string()),
        ],
    )
    .await?;
    Ok(())
}

async fn api_key_exists(
    database: &crate::db::Database,
    user_id: i64,
    name: &str,
) -> FerrotuneApiResult<bool> {
    let existing = crate::db::raw::query_scalar::<String>(
        database.conn(),
        "SELECT token FROM api_keys WHERE user_id = ? AND name = ?",
        "SELECT token FROM api_keys WHERE user_id = $1 AND name = $2",
        [Value::from(user_id), Value::from(name.to_string())],
    )
    .await?;

    Ok(existing.is_some())
}

async fn delete_api_key_db(
    database: &crate::db::Database,
    user_id: i64,
    name: &str,
) -> FerrotuneApiResult<()> {
    crate::db::raw::execute(
        database.conn(),
        "DELETE FROM api_keys WHERE user_id = ? AND name = ?",
        "DELETE FROM api_keys WHERE user_id = $1 AND name = $2",
        [Value::from(user_id), Value::from(name.to_string())],
    )
    .await?;
    Ok(())
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
    let access = crate::db::raw::query_scalar::<i64>(
        database.conn(),
        "SELECT 1 FROM user_library_access WHERE user_id = ? AND music_folder_id = ?",
        "SELECT 1::BIGINT FROM user_library_access WHERE user_id = $1 AND music_folder_id = $2",
        [Value::from(user_id), Value::from(folder_id)],
    )
    .await?;

    Ok(access.is_some())
}

/// Check if a user has access to a specific song
pub async fn user_has_song_access(
    database: &crate::db::Database,
    user_id: i64,
    song_id: &str,
) -> FerrotuneApiResult<bool> {
    let access = crate::db::raw::query_scalar::<i64>(
        database.conn(),
        "SELECT 1 FROM songs s
         JOIN user_library_access ula ON s.music_folder_id = ula.music_folder_id
         WHERE s.id = ? AND ula.user_id = ?",
        "SELECT 1::BIGINT FROM songs s
         JOIN user_library_access ula ON s.music_folder_id = ula.music_folder_id
         WHERE s.id = $1 AND ula.user_id = $2",
        [Value::from(song_id.to_string()), Value::from(user_id)],
    )
    .await?;

    Ok(access.is_some())
}

/// Get the list of music folder IDs a user has access to
#[allow(dead_code)]
pub async fn get_user_accessible_folders(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<Vec<i64>> {
    get_user_library_access(database, user_id).await
}
