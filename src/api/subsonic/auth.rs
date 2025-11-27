use crate::api::subsonic::xml::ResponseFormat;
use crate::api::CommonParams;
use crate::db::queries;
use crate::error::{Error, Result};
use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct AuthenticatedUser {
    pub user_id: i64,
    pub username: String,
    pub is_admin: bool,
    pub format: ResponseFormat,
}

/// Extractor for just the response format (no auth required)
pub struct RequestFormat(pub ResponseFormat);

#[async_trait]
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

#[async_trait]
impl FromRequestParts<Arc<crate::api::AppState>> for AuthenticatedUser {
    type Rejection = Error;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<crate::api::AppState>,
    ) -> Result<Self> {
        // Extract query parameters
        let query_string = parts
            .uri
            .query()
            .ok_or_else(|| Error::Auth("Missing authentication parameters".to_string()))?;

        let params: CommonParams = serde_urlencoded::from_str(query_string)
            .map_err(|e| Error::InvalidRequest(format!("Invalid parameters: {}", e)))?;

        // Extract format from params
        let format = ResponseFormat::from_param(&params.f);

        authenticate_request(&state.pool, &params, format).await
    }
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

    // API Key authentication (preferred)
    if let Some(ref api_key) = params.api_key {
        tracing::debug!(client = %params.c, "Attempting API key authentication");
        return authenticate_with_api_key(pool, api_key, format).await;
    }

    // Token + Salt authentication
    if let (Some(ref username), Some(ref token), Some(ref salt)) = (&params.u, &params.t, &params.s)
    {
        tracing::debug!(username = %username, client = %params.c, "Attempting token authentication");
        return authenticate_with_token(pool, username, token, salt, format).await;
    }

    // Legacy password authentication (for testing only)
    if let (Some(ref username), Some(ref password)) = (&params.u, &params.p) {
        tracing::debug!(username = %username, client = %params.c, "Attempting password authentication");
        return authenticate_with_password(pool, username, password, format).await;
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
    })
}

async fn authenticate_with_token(
    pool: &SqlitePool,
    username: &str,
    token: &str,
    salt: &str,
    format: ResponseFormat,
) -> Result<AuthenticatedUser> {
    let user = queries::get_user_by_username(pool, username)
        .await?
        .ok_or_else(|| {
            tracing::warn!(username = %username, "Token auth failed: user not found");
            Error::Auth("Invalid username or password".to_string())
        })?;

    // For now, we'll store a plaintext password in the database for testing
    // In production, this would be properly hashed with argon2
    let expected_token = format!(
        "{:x}",
        md5::compute(format!("{}{}", user.password_hash, salt))
    );

    if token != expected_token {
        tracing::warn!(username = %username, "Token auth failed: invalid token");
        return Err(Error::Auth("Invalid username or password".to_string()));
    }

    tracing::info!(username = %user.username, method = "token", "User authenticated");
    Ok(AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        format,
    })
}

async fn authenticate_with_password(
    pool: &SqlitePool,
    username: &str,
    password: &str,
    format: ResponseFormat,
) -> Result<AuthenticatedUser> {
    let password = if password.starts_with("enc:") {
        // Hex-encoded password
        let hex_str = &password[4..];
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

    // For now, storing plaintext for development
    // TODO: Use argon2 for proper password hashing
    if password != user.password_hash {
        tracing::warn!(username = %username, "Password auth failed: invalid password");
        return Err(Error::Auth("Invalid username or password".to_string()));
    }

    tracing::info!(username = %user.username, method = "password", "User authenticated");
    Ok(AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        format,
    })
}

fn is_supported_version(version: &str) -> bool {
    // Support any version starting with "1." - be permissive for client compatibility
    // Most clients send their preferred version, but we respond with our actual version
    version.starts_with("1.")
}
