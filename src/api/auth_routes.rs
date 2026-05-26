use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

use crate::{
    api::{auth::FerrotuneAuthenticatedUser, AppState},
    db::{
        models::User,
        repo::{auth_sessions, users as users_repo},
    },
    error::{Error, FerrotuneApiResult},
    password,
};

const DEFAULT_URL_TOKEN_SCOPE: &str = "all";

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthLoginRequest {
    pub username: String,
    pub password: String,
    pub client_name: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthUrlTokenRequest {
    pub scope: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthUserResponse {
    #[ts(type = "number")]
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub is_admin: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthLoginResponse {
    pub user: AuthUserResponse,
    pub session_token: String,
    #[ts(type = "string")]
    pub session_expires_at: DateTime<Utc>,
    pub url_token: String,
    #[ts(type = "string")]
    pub url_token_expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthMeResponse {
    pub user: AuthUserResponse,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthSessionRefreshResponse {
    #[ts(type = "string")]
    pub session_expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AuthUrlTokenResponse {
    pub url_token: String,
    #[ts(type = "string")]
    pub url_token_expires_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub session_expires_at: DateTime<Utc>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AuthLoginRequest>,
) -> FerrotuneApiResult<Json<AuthLoginResponse>> {
    let user = authenticate_password(&state, &request.username, &request.password).await?;
    let session = auth_sessions::create_session(
        &state.database,
        user.id,
        request.client_name.as_deref(),
        auth_sessions::session_duration(),
    )
    .await?;
    let url_token = auth_sessions::create_url_token(
        &state.database,
        &session.session_id,
        user.id,
        DEFAULT_URL_TOKEN_SCOPE,
        url_token_duration(),
    )
    .await?;

    Ok(Json(AuthLoginResponse {
        user: AuthUserResponse::from(user),
        session_token: session.token,
        session_expires_at: session.expires_at,
        url_token: url_token.token,
        url_token_expires_at: url_token.expires_at,
    }))
}

pub async fn logout(
    _user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> FerrotuneApiResult<StatusCode> {
    if let Some(token) = bearer_token_from_headers(&headers) {
        auth_sessions::revoke_session_token(&state.database, token).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn me(user: FerrotuneAuthenticatedUser) -> FerrotuneApiResult<Json<AuthMeResponse>> {
    Ok(Json(AuthMeResponse {
        user: AuthUserResponse {
            id: user.user_id,
            username: user.username,
            email: None,
            is_admin: user.is_admin,
        },
    }))
}

pub async fn refresh_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> FerrotuneApiResult<Json<AuthSessionRefreshResponse>> {
    let token = bearer_token_from_headers(&headers)
        .ok_or_else(|| Error::Auth("Bearer session required".to_string()))?;
    let authenticated = auth_sessions::authenticate_session_token(&state.database, token)
        .await?
        .ok_or_else(|| Error::Auth("Invalid or expired session".to_string()))?;

    Ok(Json(AuthSessionRefreshResponse {
        session_expires_at: authenticated.expires_at,
    }))
}

pub async fn create_url_token(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<AuthUrlTokenRequest>,
) -> FerrotuneApiResult<Json<AuthUrlTokenResponse>> {
    let token = bearer_token_from_headers(&headers)
        .ok_or_else(|| Error::Auth("Bearer session required".to_string()))?;
    let authenticated = auth_sessions::authenticate_session_token(&state.database, token)
        .await?
        .ok_or_else(|| Error::Auth("Invalid or expired session".to_string()))?;
    let scope = request.scope.as_deref().unwrap_or(DEFAULT_URL_TOKEN_SCOPE);
    let url_token = auth_sessions::create_url_token(
        &state.database,
        &authenticated.session_id,
        authenticated.user.id,
        scope,
        url_token_duration(),
    )
    .await?;

    Ok(Json(AuthUrlTokenResponse {
        url_token: url_token.token,
        url_token_expires_at: url_token.expires_at,
        session_expires_at: authenticated.expires_at,
    }))
}

async fn authenticate_password(
    state: &AppState,
    username: &str,
    password: &str,
) -> FerrotuneApiResult<User> {
    let user = users_repo::get_user_by_username(&state.database, username)
        .await?
        .ok_or_else(invalid_login)?;

    if !password::verify_password(password, &user.password_hash) {
        return Err(invalid_login().into());
    }

    Ok(user)
}

fn invalid_login() -> Error {
    Error::Auth("Invalid username or password".to_string())
}

fn bearer_token_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

fn url_token_duration() -> Duration {
    Duration::minutes(30)
}

impl From<User> for AuthUserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            email: user.email,
            is_admin: user.is_admin,
        }
    }
}
