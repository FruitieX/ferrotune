use crate::api::subsonic::xml::ResponseFormat;
use crate::api::CommonParams;
use crate::db::queries;
use crate::error::{Error, FerrotuneApiError, Result};
use crate::password;
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sqlx::SqlitePool;
use std::sync::Arc;

/// Authenticated user for OpenSubsonic API endpoints.
/// Auth failures return HTTP 200 with error in body per Subsonic spec.
pub struct AuthenticatedUser {
    pub user_id: i64,
    pub username: String,
    pub is_admin: bool,
    pub format: ResponseFormat,
    pub client: String,
}

/// Authenticated user for Ferrotune Admin API endpoints.
/// Auth failures return proper HTTP status codes (e.g., 401 for unauthorized).
/// This is a simple wrapper around AuthenticatedUser with different error handling.
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

/// Extractor for just the response format (no auth required)
#[allow(dead_code)]
pub struct RequestFormat(pub ResponseFormat);

impl<S: Send + Sync> FromRequestParts<S> for RequestFormat {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> std::result::Result<Self, Self::Rejection> {
        let format = parts
            .uri
            .query()
            .and_then(|q| q.split('&').find(|p| p.starts_with("f=")).map(|p| &p[2..]))
            .map(ResponseFormat::from_param)
            .unwrap_or(ResponseFormat::Xml);

        Ok(RequestFormat(format))
    }
}

impl FromRequestParts<Arc<crate::api::AppState>> for AuthenticatedUser {
    type Rejection = Error;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<crate::api::AppState>,
    ) -> Result<Self> {
        // Try HTTP Basic Auth first (useful for Admin API and tools like curl)
        if let Some(user) = try_basic_auth(parts, &state.pool).await? {
            return Ok(user);
        }

        // Try API key via X-Api-Key header (used by native mobile client)
        if let Some(user) = try_api_key_header(parts, &state.pool).await? {
            return Ok(user);
        }

        // Fall back to Subsonic query parameter authentication
        let query_string = parts.uri.query().unwrap_or("");

        // Parse common params - use defaults for missing fields (for Admin API compatibility)
        let params: CommonParams =
            serde_urlencoded::from_str(query_string).unwrap_or_else(|_| CommonParams {
                u: None,
                p: None,
                t: None,
                s: None,
                api_key: None,
                v: "1.16.1".to_string(),
                c: "unknown".to_string(),
                f: "json".to_string(),
            });

        // Extract format from params
        let format = ResponseFormat::from_param(&params.f);

        // Check if we have any query-based auth
        let has_query_auth = params.api_key.is_some()
            || (params.u.is_some()
                && (params.p.is_some() || (params.t.is_some() && params.s.is_some())));

        if !has_query_auth {
            return Err(Error::Auth(
                "No valid authentication provided. Use HTTP Basic Auth, API key, or query parameters (u/p or u/t/s).".to_string(),
            ));
        }

        authenticate_request(&state.pool, &params, format).await
    }
}

/// FerrotuneAuthenticatedUser extractor for the Ferrotune Admin API.
/// This reuses the same authentication logic but returns FerrotuneApiError
/// which translates to proper HTTP status codes (e.g., 401 for auth failures).
impl FromRequestParts<Arc<crate::api::AppState>> for FerrotuneAuthenticatedUser {
    type Rejection = FerrotuneApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<crate::api::AppState>,
    ) -> std::result::Result<Self, FerrotuneApiError> {
        // Reuse the AuthenticatedUser extraction logic
        let user = AuthenticatedUser::from_request_parts(parts, state).await?;
        Ok(user.into())
    }
}

async fn try_basic_auth(parts: &Parts, pool: &SqlitePool) -> Result<Option<AuthenticatedUser>> {
    let auth_header = match parts.headers.get(AUTHORIZATION) {
        Some(h) => h,
        None => return Ok(None),
    };

    let auth_str = auth_header
        .to_str()
        .map_err(|_| Error::Auth("Invalid Authorization header".to_string()))?;

    let credentials = match auth_str.strip_prefix("Basic ") {
        Some(c) => c,
        None => return Ok(None), // Not Basic auth, try other methods
    };

    let decoded = BASE64
        .decode(credentials.trim())
        .map_err(|_| Error::Auth("Invalid base64 in Authorization header".to_string()))?;

    let decoded_str = String::from_utf8(decoded)
        .map_err(|_| Error::Auth("Invalid UTF-8 in Authorization header".to_string()))?;

    let (username, password) = decoded_str
        .split_once(':')
        .ok_or_else(|| Error::Auth("Invalid Basic auth format".to_string()))?;

    // Get format from query params if available, default to JSON for Basic auth
    let format = parts
        .uri
        .query()
        .and_then(|q| q.split('&').find(|p| p.starts_with("f=")).map(|p| &p[2..]))
        .map(ResponseFormat::from_param)
        .unwrap_or(ResponseFormat::Json);

    // Get client from query params if available
    let client = parts
        .uri
        .query()
        .and_then(|q| {
            q.split('&')
                .find(|p| p.starts_with("c="))
                .map(|p| p[2..].to_string())
        })
        .unwrap_or_else(|| "http-basic".to_string());

    authenticate_with_password(pool, username, password, format, client)
        .await
        .map(Some)
}

async fn try_api_key_header(parts: &Parts, pool: &SqlitePool) -> Result<Option<AuthenticatedUser>> {
    let header_value = match parts.headers.get("X-Api-Key") {
        Some(h) => h,
        None => return Ok(None),
    };

    let api_key = header_value
        .to_str()
        .map_err(|_| Error::Auth("Invalid X-Api-Key header".to_string()))?;

    let format = parts
        .uri
        .query()
        .and_then(|q| q.split('&').find(|p| p.starts_with("f=")).map(|p| &p[2..]))
        .map(ResponseFormat::from_param)
        .unwrap_or(ResponseFormat::Json);

    let client = parts
        .uri
        .query()
        .and_then(|q| {
            q.split('&')
                .find(|p| p.starts_with("c="))
                .map(|p| p[2..].to_string())
        })
        .unwrap_or_else(|| "api-key-header".to_string());

    authenticate_with_api_key(pool, api_key, format, client)
        .await
        .map(Some)
}

pub async fn authenticate_request(
    pool: &SqlitePool,
    params: &CommonParams,
    format: ResponseFormat,
) -> Result<AuthenticatedUser> {
    // Check API version
    if !is_supported_version(&params.v) {
        tracing::warn!(version = %params.v, client = %params.c, "Unsupported API version");
        return Err(Error::InvalidRequest(format!(
            "Unsupported API version: {}",
            params.v
        )));
    }

    // Check for conflicting authentication parameters
    // Per OpenSubsonic spec: If apiKey is specified, none of p, t, s, or u can be specified
    if params.api_key.is_some()
        && (params.u.is_some() || params.p.is_some() || params.t.is_some() || params.s.is_some())
    {
        tracing::warn!(client = %params.c, "Conflicting authentication parameters: apiKey with user credentials");
        return Err(Error::ConflictingAuthParams);
    }

    let client = params.c.clone();

    // API Key authentication (preferred)
    if let Some(ref api_key) = params.api_key {
        tracing::debug!(client = %params.c, "Attempting API key authentication");
        return authenticate_with_api_key(pool, api_key, format, client).await;
    }

    // Token + Salt authentication
    if let (Some(ref username), Some(ref token), Some(ref salt)) = (&params.u, &params.t, &params.s)
    {
        tracing::debug!(username = %username, client = %params.c, "Attempting token authentication");
        return authenticate_with_token(pool, username, token, salt, format, client).await;
    }

    // Legacy password authentication (for testing only)
    if let (Some(ref username), Some(ref password)) = (&params.u, &params.p) {
        tracing::debug!(username = %username, client = %params.c, "Attempting password authentication");
        return authenticate_with_password(pool, username, password, format, client).await;
    }

    tracing::warn!(client = %params.c, "No valid authentication method provided");
    Err(Error::Auth(
        "No valid authentication method provided".to_string(),
    ))
}

async fn authenticate_with_api_key(
    pool: &SqlitePool,
    token: &str,
    format: ResponseFormat,
    client: String,
) -> Result<AuthenticatedUser> {
    let user = queries::get_user_by_api_key(pool, token)
        .await?
        .ok_or_else(|| {
            tracing::warn!("Invalid API key attempted");
            Error::InvalidApiKey
        })?;

    tracing::info!(username = %user.username, method = "api_key", "User authenticated");
    Ok(AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        format,
        client,
    })
}

async fn authenticate_with_token(
    pool: &SqlitePool,
    username: &str,
    token: &str,
    salt: &str,
    format: ResponseFormat,
    client: String,
) -> Result<AuthenticatedUser> {
    let user = queries::get_user_by_username(pool, username)
        .await?
        .ok_or_else(|| {
            tracing::warn!(username = %username, "Token auth failed: user not found");
            Error::Auth("Invalid username or password".to_string())
        })?;

    let stored_token = user.subsonic_token.as_deref().ok_or_else(|| {
        tracing::warn!(username = %username, "Token auth failed: no subsonic_token set");
        Error::Auth("Invalid username or password".to_string())
    })?;

    if !password::verify_subsonic_token(token, salt, stored_token) {
        tracing::warn!(username = %username, "Token auth failed: invalid token");
        return Err(Error::Auth("Invalid username or password".to_string()));
    }

    tracing::info!(username = %user.username, method = "token", "User authenticated");
    Ok(AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        format,
        client,
    })
}

async fn authenticate_with_password(
    pool: &SqlitePool,
    username: &str,
    password: &str,
    format: ResponseFormat,
    client: String,
) -> Result<AuthenticatedUser> {
    let password = if let Some(hex_str) = password.strip_prefix("enc:") {
        // Hex-encoded password
        String::from_utf8(
            hex::decode(hex_str)
                .map_err(|e| Error::InvalidRequest(format!("Invalid hex encoding: {}", e)))?,
        )
        .map_err(|e| Error::InvalidRequest(format!("Invalid UTF-8 in password: {}", e)))?
    } else {
        password.to_string()
    };

    let user = queries::get_user_by_username(pool, username)
        .await?
        .ok_or_else(|| {
            tracing::warn!(username = %username, "Password auth failed: user not found");
            Error::Auth("Invalid username or password".to_string())
        })?;

    if !password::verify_password(&password, &user.password_hash) {
        tracing::warn!(username = %username, "Password auth failed: invalid password");
        return Err(Error::Auth("Invalid username or password".to_string()));
    }

    tracing::info!(username = %user.username, method = "password", "User authenticated");
    Ok(AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        format,
        client,
    })
}

fn is_supported_version(version: &str) -> bool {
    // Support any version starting with "1." - be permissive for client compatibility
    // Most clients send their preferred version, but we respond with our actual version
    version.starts_with("1.")
}
