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

async fn get_lastfm_credentials(
    database: &crate::db::Database,
    user_id: i64,
) -> Result<Option<(String, String, String)>, String> {
    crate::db::repo::users::get_lastfm_credentials(database, user_id)
        .await
        .map_err(|e| format!("DB error: {}", e))
}

async fn get_lastfm_song_metadata(
    database: &crate::db::Database,
    song_id: &str,
) -> Result<Option<(String, String, Option<String>, Option<i64>)>, String> {
    let row = crate::db::repo::media::get_song_scrobble_metadata(database, song_id)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(row.map(|r| (r.title, r.name, r.album_name, r.duration)))
}

async fn get_lastfm_config_row(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<Option<(Option<String>, Option<String>)>> {
    crate::db::repo::users::get_lastfm_config(database, user_id).await
}

async fn get_lastfm_status_row(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<Option<(Option<String>, Option<String>, Option<String>)>> {
    crate::db::repo::users::get_lastfm_status(database, user_id).await
}

async fn update_lastfm_session_row(
    database: &crate::db::Database,
    user_id: i64,
    session_key: Option<&str>,
    username: Option<&str>,
) -> crate::error::Result<()> {
    crate::db::repo::users::update_lastfm_session(database, user_id, session_key, username).await
}

async fn update_lastfm_config_row(
    database: &crate::db::Database,
    user_id: i64,
    api_key: &str,
    api_secret: &str,
) -> crate::error::Result<()> {
    crate::db::repo::users::update_lastfm_config(database, user_id, api_key, api_secret).await
}

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
    let api_key = get_lastfm_config_row(&state.database, user.user_id)
        .await?
        .and_then(|(api_key, _)| api_key);

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
    let row = get_lastfm_config_row(&state.database, user.user_id).await?;

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
    update_lastfm_session_row(
        &state.database,
        user.user_id,
        Some(&session.key),
        Some(&session.name),
    )
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
    let row = get_lastfm_status_row(&state.database, user.user_id).await?;

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
    update_lastfm_session_row(&state.database, user.user_id, None, None).await?;

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
    database: &crate::db::Database,
    user_id: i64,
    song_id: &str,
    timestamp: i64,
) -> Result<(), String> {
    let Some((api_key, api_secret, session_key)) =
        get_lastfm_credentials(database, user_id).await?
    else {
        return Ok(()); // User hasn't configured Last.fm
    };

    // Get song metadata for scrobbling
    let Some((title, artist, album, duration)) =
        get_lastfm_song_metadata(database, song_id).await?
    else {
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
    database: &crate::db::Database,
    user_id: i64,
    song_id: &str,
) -> Result<(), String> {
    let Some((api_key, api_secret, session_key)) =
        get_lastfm_credentials(database, user_id).await?
    else {
        return Ok(());
    };

    let Some((title, artist, album, duration)) =
        get_lastfm_song_metadata(database, song_id).await?
    else {
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
    let row = get_lastfm_config_row(&state.database, user.user_id).await?;

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
    update_lastfm_config_row(&state.database, user.user_id, &req.api_key, &req.api_secret).await?;

    Ok(Json(LastfmConfigResponse {
        api_key: req.api_key,
        api_secret: req.api_secret,
    }))
}
