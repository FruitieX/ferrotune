use crate::db::repo;
use crate::db::Database;
use crate::error::{Error, FerrotuneApiError, Result};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, Method},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::HashMap;
use std::sync::Arc;

/// Authenticated API user.
pub struct AuthenticatedUser {
    pub user_id: i64,
    pub username: String,
    pub is_admin: bool,
    pub client: String,
}

/// Authenticated user for API endpoints that should return HTTP-native errors.
pub struct FerrotuneAuthenticatedUser {
    pub user_id: i64,
    pub username: String,
    pub is_admin: bool,
}

impl From<AuthenticatedUser> for FerrotuneAuthenticatedUser {
    fn from(user: AuthenticatedUser) -> Self {
        FerrotuneAuthenticatedUser {
            user_id: user.user_id,
            username: user.username,
            is_admin: user.is_admin,
        }
    }
}

impl FromRequestParts<Arc<crate::api::AppState>> for AuthenticatedUser {
    type Rejection = Error;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<crate::api::AppState>,
    ) -> Result<Self> {
        if let Some(user) = try_bearer_auth(parts, &state.database).await? {
            return Ok(user);
        }

        if let Some(user) = try_basic_auth(parts, &state.database).await? {
            return Ok(user);
        }

        if let Some(user) = try_url_token_auth(parts, &state.database).await? {
            return Ok(user);
        }

        Err(Error::Auth(
            "No valid authentication provided. Use a Bearer session or HTTP Basic Auth."
                .to_string(),
        ))
    }
}

impl FromRequestParts<Arc<crate::api::AppState>> for FerrotuneAuthenticatedUser {
    type Rejection = FerrotuneApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<crate::api::AppState>,
    ) -> std::result::Result<Self, FerrotuneApiError> {
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        Ok(user.into())
    }
}

async fn try_bearer_auth(parts: &Parts, database: &Database) -> Result<Option<AuthenticatedUser>> {
    let auth_header = match parts.headers.get(AUTHORIZATION) {
        Some(header) => header,
        None => return Ok(None),
    };

    let auth_str = auth_header
        .to_str()
        .map_err(|_| Error::Auth("Invalid Authorization header".to_string()))?;

    let token = match auth_str.strip_prefix("Bearer ") {
        Some(token) => token.trim(),
        None => return Ok(None),
    };

    let client = request_client(parts, "bearer-session");
    let authenticated = repo::auth_sessions::authenticate_session_token(database, token)
        .await?
        .ok_or_else(|| Error::Auth("Invalid or expired session".to_string()))?;

    tracing::info!(
        username = %authenticated.user.username,
        method = "bearer_session",
        "User authenticated"
    );

    Ok(Some(authenticated_user_from_model(
        authenticated.user,
        client,
    )))
}

async fn try_basic_auth(parts: &Parts, database: &Database) -> Result<Option<AuthenticatedUser>> {
    let auth_header = match parts.headers.get(AUTHORIZATION) {
        Some(header) => header,
        None => return Ok(None),
    };

    let auth_str = auth_header
        .to_str()
        .map_err(|_| Error::Auth("Invalid Authorization header".to_string()))?;

    let credentials = match auth_str.strip_prefix("Basic ") {
        Some(credentials) => credentials,
        None => return Ok(None),
    };

    let decoded = BASE64
        .decode(credentials.trim())
        .map_err(|_| Error::Auth("Invalid base64 in Authorization header".to_string()))?;

    let decoded_str = String::from_utf8(decoded)
        .map_err(|_| Error::Auth("Invalid UTF-8 in Authorization header".to_string()))?;

    let (username, password) = decoded_str
        .split_once(':')
        .ok_or_else(|| Error::Auth("Invalid Basic auth format".to_string()))?;

    authenticate_with_password(
        database,
        username,
        password,
        request_client(parts, "http-basic"),
    )
    .await
    .map(Some)
}

async fn try_url_token_auth(
    parts: &Parts,
    database: &Database,
) -> Result<Option<AuthenticatedUser>> {
    let Some(required_scope) = url_token_scope_for_request(parts) else {
        return Ok(None);
    };
    let Some(token) = query_param(parts, "urlToken").or_else(|| query_param(parts, "url_token"))
    else {
        return Ok(None);
    };

    let client = request_client(parts, "url-token");
    let authenticated =
        repo::auth_sessions::authenticate_url_token(database, &token, required_scope)
            .await?
            .ok_or_else(|| Error::Auth("Invalid or expired URL token".to_string()))?;

    tracing::info!(
        username = %authenticated.user.username,
        method = "url_token",
        scope = required_scope,
        "User authenticated"
    );

    Ok(Some(authenticated_user_from_model(
        authenticated.user,
        client,
    )))
}

async fn authenticate_with_password(
    database: &Database,
    username: &str,
    password: &str,
    client: String,
) -> Result<AuthenticatedUser> {
    let user = repo::users::get_user_by_username(database, username)
        .await?
        .ok_or_else(|| {
            tracing::warn!(username = %username, "Password auth failed: user not found");
            Error::Auth("Invalid username or password".to_string())
        })?;

    if !crate::password::verify_password(password, &user.password_hash) {
        tracing::warn!(username = %username, "Password auth failed: invalid password");
        return Err(Error::Auth("Invalid username or password".to_string()));
    }

    tracing::info!(username = %user.username, method = "password", "User authenticated");
    Ok(authenticated_user_from_model(user, client))
}

fn authenticated_user_from_model(
    user: crate::db::models::User,
    client: String,
) -> AuthenticatedUser {
    AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        client,
    }
}

fn request_client(parts: &Parts, default: &str) -> String {
    query_param(parts, "c").unwrap_or_else(|| default.to_string())
}

fn query_param(parts: &Parts, key: &str) -> Option<String> {
    serde_urlencoded::from_str::<HashMap<String, String>>(parts.uri.query()?)
        .ok()
        .and_then(|mut params| params.remove(key))
}

fn url_token_scope_for_request(parts: &Parts) -> Option<&'static str> {
    let path = parts.uri.path();

    // The tab-close disconnect beacon is fired by `navigator.sendBeacon`
    // during page unload and cannot easily set a Bearer header, so it is
    // authenticated via URL token instead. It is the only non-GET endpoint
    // that accepts a URL token.
    if parts.method == Method::DELETE {
        if path == "/api/sessions/{id}/clients/{client_id}"
            || (path.starts_with("/api/sessions/")
                && path.matches('/').count() >= 5
                && path.contains("/clients/"))
        {
            return Some("all");
        }
        return None;
    }

    if parts.method != Method::GET {
        return None;
    }

    if matches!(path, "/scan/progress" | "/api/scan/progress") || path.ends_with("/events") {
        return Some("events");
    }

    if matches!(
        path,
        "/stream" | "/cover-art" | "/download" | "/api/stream" | "/api/cover-art" | "/api/download"
    ) || path.ends_with("/stream")
        || path.ends_with("/cover")
    {
        return Some("media");
    }

    None
}
