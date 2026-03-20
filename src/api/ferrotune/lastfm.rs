//! Last.fm integration for scrobbling and authentication.
//!
//! All Last.fm credentials (API key, API secret, session key) are stored
//! per-user in the database, configured via the settings UI.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{Query, State},
    response::Json,
};
use md5;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

const LASTFM_API_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_AUTH_URL: &str = "https://www.last.fm/api/auth/";

/// Generate Last.fm API method signature.
///
/// Per the spec: sort params alphabetically, concatenate key+value pairs, append secret, MD5 hash.
fn api_sig(params: &[(&str, &str)], secret: &str) -> String {
    let mut sorted: Vec<(&str, &str)> = params.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let mut sig_input = String::new();
    for (k, v) in &sorted {
        sig_input.push_str(k);
        sig_input.push_str(v);
    }
    sig_input.push_str(secret);

    format!("{:x}", md5::compute(sig_input))
}

// ============================================================================
// Auth endpoints
// ============================================================================

/// Response with the Last.fm authorization URL.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LastfmAuthUrlResponse {
    pub url: String,
    pub enabled: bool,
}

/// Get the Last.fm authorization URL for the current user.
///
/// GET /ferrotune/lastfm/auth-url?callbackUrl=...
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUrlParams {
    pub callback_url: String,
}

pub async fn get_auth_url(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AuthUrlParams>,
) -> FerrotuneApiResult<Json<LastfmAuthUrlResponse>> {
    let api_key: Option<String> =
        sqlx::query_scalar("SELECT lastfm_api_key FROM users WHERE id = ?")
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;

    let Some(api_key) = api_key.filter(|k| !k.is_empty()) else {
        return Ok(Json(LastfmAuthUrlResponse {
            url: String::new(),
            enabled: false,
        }));
    };

    let url = format!(
        "{}?api_key={}&cb={}",
        LASTFM_AUTH_URL,
        api_key,
        urlencoding::encode(&params.callback_url),
    );

    Ok(Json(LastfmAuthUrlResponse { url, enabled: true }))
}

/// Request to exchange a Last.fm auth token for a session key.
#[derive(Deserialize)]
pub struct CallbackParams {
    pub token: String,
}

/// Response after connecting Last.fm account.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LastfmConnectResponse {
    pub success: bool,
    pub username: Option<String>,
}

/// Exchange a Last.fm auth token for a session key.
///
/// POST /ferrotune/lastfm/callback?token=...
pub async fn callback(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CallbackParams>,
) -> FerrotuneApiResult<Json<LastfmConnectResponse>> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT lastfm_api_key, lastfm_api_secret FROM users WHERE id = ?")
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;

    let (Some(api_key), Some(api_secret)) = row
        .map(|(k, s)| (k.unwrap_or_default(), s.unwrap_or_default()))
        .map(|(k, s)| {
            (
                if k.is_empty() { None } else { Some(k) },
                if s.is_empty() { None } else { Some(s) },
            )
        })
        .unwrap_or((None, None))
    else {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "Last.fm API key/secret not configured".to_string(),
        )));
    };

    let session = get_session(&api_key, &api_secret, &params.token)
        .await
        .map_err(|e| {
            FerrotuneApiError::from(Error::Internal(format!("Last.fm auth failed: {}", e)))
        })?;

    // Store session key and username
    sqlx::query("UPDATE users SET lastfm_session_key = ?, lastfm_username = ? WHERE id = ?")
        .bind(&session.key)
        .bind(&session.name)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(LastfmConnectResponse {
        success: true,
        username: Some(session.name),
    }))
}

/// Get the Last.fm connection status for the current user.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LastfmStatusResponse {
    pub connected: bool,
    pub username: Option<String>,
    pub enabled: bool,
}

pub async fn status(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<LastfmStatusResponse>> {
    let row: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT lastfm_api_key, lastfm_session_key, lastfm_username FROM users WHERE id = ?",
    )
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;

    let (enabled, connected, username) = match row {
        Some((api_key, session_key, username)) => {
            let has_key = api_key.as_deref().is_some_and(|k| !k.is_empty());
            let has_session = session_key.is_some();
            (has_key, has_session, username)
        }
        _ => (false, false, None),
    };

    Ok(Json(LastfmStatusResponse {
        connected,
        username,
        enabled,
    }))
}

/// Disconnect Last.fm account.
///
/// POST /ferrotune/lastfm/disconnect
pub async fn disconnect(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<LastfmConnectResponse>> {
    sqlx::query("UPDATE users SET lastfm_session_key = NULL, lastfm_username = NULL WHERE id = ?")
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(LastfmConnectResponse {
        success: true,
        username: None,
    }))
}

// ============================================================================
// Scrobble forwarding
// ============================================================================

/// Forward a scrobble to Last.fm.
///
/// Called internally when a song is scrobbled locally.
pub async fn forward_scrobble(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    song_id: &str,
    timestamp: i64,
) -> Result<(), String> {
    // Get user's Last.fm credentials
    let row: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT lastfm_api_key, lastfm_api_secret, lastfm_session_key FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let Some((Some(api_key), Some(api_secret), Some(session_key))) = row else {
        return Ok(()); // User hasn't configured Last.fm
    };

    if api_key.is_empty() || api_secret.is_empty() {
        return Ok(());
    }

    // Get song metadata for scrobbling
    let song: Option<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT s.title, ar.name, al.name, s.duration
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = ?",
    )
    .bind(song_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let Some((title, artist, album, duration)) = song else {
        return Err("Song not found".to_string());
    };

    let timestamp_str = timestamp.to_string();
    let mut params: Vec<(&str, &str)> = vec![
        ("method", "track.scrobble"),
        ("api_key", &api_key),
        ("sk", &session_key),
        ("artist", &artist),
        ("track", &title),
        ("timestamp", &timestamp_str),
    ];

    let album_ref;
    if let Some(ref a) = album {
        album_ref = a.as_str();
        params.push(("album", album_ref));
    }

    let duration_str;
    if let Some(d) = duration {
        duration_str = d.to_string();
        params.push(("duration", &duration_str));
    }

    let sig = api_sig(&params, &api_secret);
    params.push(("api_sig", &sig));
    params.push(("format", "json"));

    let client = reqwest::Client::new();
    let response = client
        .post(LASTFM_API_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Last.fm API error: {}", body));
    }

    Ok(())
}

/// Send a "now playing" notification to Last.fm.
pub async fn update_now_playing(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    song_id: &str,
) -> Result<(), String> {
    // Get user's Last.fm credentials
    let row: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT lastfm_api_key, lastfm_api_secret, lastfm_session_key FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let Some((Some(api_key), Some(api_secret), Some(session_key))) = row else {
        return Ok(());
    };

    if api_key.is_empty() || api_secret.is_empty() {
        return Ok(());
    }

    let song: Option<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT s.title, ar.name, al.name, s.duration
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = ?",
    )
    .bind(song_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let Some((title, artist, album, duration)) = song else {
        return Err("Song not found".to_string());
    };

    let mut params: Vec<(&str, &str)> = vec![
        ("method", "track.updateNowPlaying"),
        ("api_key", &api_key),
        ("sk", &session_key),
        ("artist", &artist),
        ("track", &title),
    ];

    let album_ref;
    if let Some(ref a) = album {
        album_ref = a.as_str();
        params.push(("album", album_ref));
    }

    let duration_str;
    if let Some(d) = duration {
        duration_str = d.to_string();
        params.push(("duration", &duration_str));
    }

    let sig = api_sig(&params, &api_secret);
    params.push(("api_sig", &sig));
    params.push(("format", "json"));

    let client = reqwest::Client::new();
    let response = client
        .post(LASTFM_API_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Last.fm API error: {}", body));
    }

    Ok(())
}

// ============================================================================
// Internal helpers
// ============================================================================

#[derive(Deserialize)]
struct LastfmSessionResponse {
    session: LastfmSession,
}

#[derive(Deserialize)]
struct LastfmSession {
    name: String,
    key: String,
}

/// Exchange an auth token for a session key via auth.getSession.
async fn get_session(
    api_key: &str,
    api_secret: &str,
    token: &str,
) -> Result<LastfmSession, String> {
    let params = [
        ("method", "auth.getSession"),
        ("api_key", api_key),
        ("token", token),
    ];
    let sig = api_sig(&params, api_secret);

    let client = reqwest::Client::new();
    let response = client
        .get(LASTFM_API_URL)
        .query(&[
            ("method", "auth.getSession"),
            ("api_key", api_key),
            ("token", token),
            ("api_sig", &sig),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Last.fm auth error: {}", body));
    }

    let body: LastfmSessionResponse = response
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    Ok(body.session)
}

// ============================================================================
// Per-user Last.fm config management
// ============================================================================

/// Request to save Last.fm API credentials.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigRequest {
    pub api_key: String,
    pub api_secret: String,
}

/// Response for Last.fm config.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LastfmConfigResponse {
    pub api_key: String,
    pub api_secret: String,
}

/// Get the current user's Last.fm API config.
///
/// GET /ferrotune/lastfm/config
pub async fn get_config(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<LastfmConfigResponse>> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT lastfm_api_key, lastfm_api_secret FROM users WHERE id = ?")
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;

    let (api_key, api_secret) = row.unwrap_or((None, None));

    Ok(Json(LastfmConfigResponse {
        api_key: api_key.unwrap_or_default(),
        api_secret: api_secret.unwrap_or_default(),
    }))
}

/// Save the current user's Last.fm API credentials.
///
/// PUT /ferrotune/lastfm/config
pub async fn save_config(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<SaveConfigRequest>,
) -> FerrotuneApiResult<Json<LastfmConfigResponse>> {
    sqlx::query("UPDATE users SET lastfm_api_key = ?, lastfm_api_secret = ? WHERE id = ?")
        .bind(&req.api_key)
        .bind(&req.api_secret)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(LastfmConfigResponse {
        api_key: req.api_key,
        api_secret: req.api_secret,
    }))
}
