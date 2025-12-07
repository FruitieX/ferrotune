//! User management endpoints for the Ferrotune Admin API.
//!
//! These endpoints allow admin users to manage other users:
//! - Create new users
//! - Update user details (password, email, admin status)
//! - Delete users
//! - Manage library access (which music folders a user can see)
//! - Manage API keys

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::models::User;
use crate::error::{Error, Result};
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

// ============================================================================
// Helper: Check admin permission
// ============================================================================

fn require_admin(user: &AuthenticatedUser) -> Result<()> {
    if !user.is_admin {
        return Err(Error::Auth(
            "Admin privileges required".to_string(),
        ));
    }
    Ok(())
}

// ============================================================================
// User CRUD Endpoints
// ============================================================================

/// GET /ferrotune/users/me - Get current user info (any authenticated user)
pub async fn get_current_user(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<UserInfo>> {
    // Fetch the full user record from database to get all fields
    let u: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;

    let library_access = get_user_library_access(&state, user.user_id).await?;

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<UsersResponse>> {
    require_admin(&user)?;

    let users: Vec<User> = sqlx::query_as("SELECT * FROM users ORDER BY id")
        .fetch_all(&state.pool)
        .await?;

    let mut user_infos = Vec::with_capacity(users.len());
    for u in users {
        let library_access = get_user_library_access(&state, u.id).await?;
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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<UserInfo>> {
    require_admin(&user)?;

    let u: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| Error::NotFound(format!("User {} not found", id)))?;

    let library_access = get_user_library_access(&state, u.id).await?;

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateUserRequest>,
) -> Result<impl IntoResponse> {
    require_admin(&user)?;

    // Validate username
    if request.username.is_empty() {
        return Err(Error::InvalidRequest("Username cannot be empty".to_string()));
    }
    if request.username.len() < 3 {
        return Err(Error::InvalidRequest(
            "Username must be at least 3 characters".to_string(),
        ));
    }

    // Validate password
    if request.password.len() < 8 {
        return Err(Error::InvalidRequest(
            "Password must be at least 8 characters".to_string(),
        ));
    }

    // Check if username already exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE username = ?")
        .bind(&request.username)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(Error::InvalidRequest(format!(
            "Username '{}' is already taken",
            request.username
        )));
    }

    // Hash the password using argon2
    let password_hash = password::hash_password(&request.password)
        .map_err(|e| Error::Internal(format!("Failed to hash password: {}", e)))?;
    // Create subsonic token for legacy token+salt authentication
    let subsonic_token = password::create_subsonic_token(&request.password);

    // Create the user with hashed password
    let result = sqlx::query(
        "INSERT INTO users (username, password_hash, subsonic_token, email, is_admin) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&request.username)
    .bind(&password_hash)
    .bind(&subsonic_token)
    .bind(&request.email)
    .bind(request.is_admin)
    .execute(&state.pool)
    .await?;

    let user_id = result.last_insert_rowid();

    // Set up library access
    let folder_ids = if request.library_access.is_empty() {
        // Grant access to all folders by default
        let folders: Vec<(i64,)> = sqlx::query_as("SELECT id FROM music_folders")
            .fetch_all(&state.pool)
            .await?;
        folders.into_iter().map(|(id,)| id).collect()
    } else {
        request.library_access
    };

    for folder_id in &folder_ids {
        sqlx::query("INSERT INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)")
            .bind(user_id)
            .bind(folder_id)
            .execute(&state.pool)
            .await?;
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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<UpdateUserRequest>,
) -> Result<Json<UserInfo>> {
    require_admin(&user)?;

    // Check if user exists
    let existing: Option<User> = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    // Build update query dynamically
    let mut updates = Vec::new();

    if let Some(username) = &request.username {
        if username.len() < 3 {
            return Err(Error::InvalidRequest(
                "Username must be at least 3 characters".to_string(),
            ));
        }
        // Check if username is taken by another user
        let exists: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM users WHERE username = ? AND id != ?")
                .bind(username)
                .bind(id)
                .fetch_optional(&state.pool)
                .await?;
        if exists.is_some() {
            return Err(Error::InvalidRequest(format!(
                "Username '{}' is already taken",
                username
            )));
        }
        updates.push(("username", username.clone()));
    }

    // Handle password update specially - need to hash it
    if let Some(password) = &request.password {
        if password.len() < 8 {
            return Err(Error::InvalidRequest(
                "Password must be at least 8 characters".to_string(),
            ));
        }
        // Hash the password using argon2
        let password_hash = password::hash_password(password)
            .map_err(|e| Error::Internal(format!("Failed to hash password: {}", e)))?;
        // Create subsonic token for legacy token+salt authentication
        let subsonic_token = password::create_subsonic_token(password);
        
        // Update both password_hash and subsonic_token
        sqlx::query("UPDATE users SET password_hash = ?, subsonic_token = ? WHERE id = ?")
            .bind(&password_hash)
            .bind(&subsonic_token)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }

    if let Some(email) = &request.email {
        updates.push(("email", email.clone()));
    }

    if let Some(is_admin) = request.is_admin {
        // Prevent removing admin from self
        if id == user.user_id && !is_admin {
            return Err(Error::InvalidRequest(
                "Cannot remove your own admin privileges".to_string(),
            ));
        }
        updates.push((
            "is_admin",
            if is_admin { "1" } else { "0" }.to_string(),
        ));
    }

    // Apply non-password updates
    if !updates.is_empty() {
        for (field, value) in &updates {
            let query = format!("UPDATE users SET {} = ? WHERE id = ?", field);
            sqlx::query(&query)
                .bind(value)
                .bind(id)
                .execute(&state.pool)
                .await?;
        }
    }

    // Update library access if provided
    if let Some(folder_ids) = request.library_access {
        // Remove existing access
        sqlx::query("DELETE FROM user_library_access WHERE user_id = ?")
            .bind(id)
            .execute(&state.pool)
            .await?;

        // Add new access
        for folder_id in &folder_ids {
            sqlx::query(
                "INSERT INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
            )
            .bind(id)
            .bind(folder_id)
            .execute(&state.pool)
            .await?;
        }
    }

    // Return updated user info
    let u: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    let library_access = get_user_library_access(&state, u.id).await?;

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse> {
    require_admin(&user)?;

    // Prevent deleting self
    if id == user.user_id {
        return Err(Error::InvalidRequest("Cannot delete yourself".to_string()));
    }

    // Check if user exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    // Delete the user (cascades to api_keys, user_library_access, playlists, etc.)
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Library Access Endpoints
// ============================================================================

/// GET /ferrotune/users/{id}/library-access - Get user's library access
pub async fn get_library_access(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<LibraryAccessResponse>> {
    require_admin(&user)?;

    // Check if user exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    let access = get_user_library_access(&state, id).await?;
    Ok(Json(LibraryAccessResponse {
        user_id: id,
        folder_ids: access,
    }))
}

/// PUT /ferrotune/users/{id}/library-access - Set user's library access
pub async fn set_library_access(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<SetLibraryAccessRequest>,
) -> Result<Json<LibraryAccessResponse>> {
    require_admin(&user)?;

    // Check if user exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    // Replace existing access
    sqlx::query("DELETE FROM user_library_access WHERE user_id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    for folder_id in &request.folder_ids {
        sqlx::query("INSERT INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)")
            .bind(id)
            .bind(folder_id)
            .execute(&state.pool)
            .await?;
    }

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<ApiKeysResponse>> {
    // Allow users to view their own keys, or admin can view anyone's
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if user exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    let keys: Vec<(String, DateTime<Utc>, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT name, created_at, last_used FROM api_keys WHERE user_id = ?")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;

    let key_infos: Vec<ApiKeyInfo> = keys
        .into_iter()
        .map(|(name, created_at, last_used)| ApiKeyInfo {
            token: None, // Don't expose existing tokens
            name,
            created_at,
            last_used,
        })
        .collect();

    Ok(Json(ApiKeysResponse { api_keys: key_infos }))
}

/// POST /ferrotune/users/{id}/api-keys - Create a new API key (admin or self)
pub async fn create_api_key(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(request): Json<CreateApiKeyRequest>,
) -> Result<impl IntoResponse> {
    // Allow users to create their own keys, or admin can create for anyone
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if user exists
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!("User {} not found", id)));
    }

    // Generate a secure random token
    let token = generate_api_key();

    // Create the key
    sqlx::query("INSERT INTO api_keys (token, user_id, name) VALUES (?, ?, ?)")
        .bind(&token)
        .bind(id)
        .bind(&request.name)
        .execute(&state.pool)
        .await?;

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
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(i64, String)>,
) -> Result<impl IntoResponse> {
    // Allow users to delete their own keys, or admin can delete anyone's
    if id != user.user_id {
        require_admin(&user)?;
    }

    // Check if key exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT token FROM api_keys WHERE user_id = ? AND name = ?")
            .bind(id)
            .bind(&name)
            .fetch_optional(&state.pool)
            .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!(
            "API key '{}' not found for user {}",
            name, id
        )));
    }

    sqlx::query("DELETE FROM api_keys WHERE user_id = ? AND name = ?")
        .bind(id)
        .bind(&name)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Helper Functions
// ============================================================================

async fn get_user_library_access(state: &AppState, user_id: i64) -> Result<Vec<i64>> {
    let access: Vec<(i64,)> =
        sqlx::query_as("SELECT music_folder_id FROM user_library_access WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(&state.pool)
            .await?;

    Ok(access.into_iter().map(|(id,)| id).collect())
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
pub async fn user_has_folder_access(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    folder_id: i64,
) -> Result<bool> {
    let access: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM user_library_access WHERE user_id = ? AND music_folder_id = ?",
    )
    .bind(user_id)
    .bind(folder_id)
    .fetch_optional(pool)
    .await?;

    Ok(access.is_some())
}

/// Check if a user has access to a specific song
pub async fn user_has_song_access(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    song_id: &str,
) -> Result<bool> {
    let access: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM songs s
         JOIN user_library_access ula ON s.music_folder_id = ula.music_folder_id
         WHERE s.id = ? AND ula.user_id = ?",
    )
    .bind(song_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(access.is_some())
}

/// Get the list of music folder IDs a user has access to
pub async fn get_user_accessible_folders(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<Vec<i64>> {
    let access: Vec<(i64,)> =
        sqlx::query_as("SELECT music_folder_id FROM user_library_access WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(pool)
            .await?;

    Ok(access.into_iter().map(|(id,)| id).collect())
}
