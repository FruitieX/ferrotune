//! HTTP side of OIDC (Pocket ID) sign-in; see `crate::oidc` for the flow.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    api::{
        auth_routes::{issue_login, AuthLoginResponse},
        AppState,
    },
    db::{
        models::User,
        repo::{oidc_identities, users as users_repo},
    },
    error::{Error, FerrotuneApiResult, Result},
    oidc::{self, Identity, Oidc},
};

/// Stored as the password hash of accounts created by OIDC sign-in. It is not
/// a valid PHC string, so no password ever verifies against it.
pub const OIDC_ONLY_PASSWORD_HASH: &str = "!oidc";

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct OidcConfigResponse {
    /// Whether this server offers "Sign in with passkey" (Pocket ID).
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcStartParams {
    /// Client URI that receives `?code=` (or `?error=`) at the end.
    pub redirect: String,
    /// PKCE S256 challenge of a verifier the client sends to the exchange.
    pub challenge: Option<String>,
    /// OIDC `prompt` for the provider: `select_account` (clients send it when
    /// adding another account) or `login`. Other values are not forwarded.
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OidcCallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct OidcExchangeRequest {
    pub code: String,
    pub code_verifier: Option<String>,
    pub client_name: Option<String>,
}

/// GET /api/auth/oidc/config (unauthenticated)
pub async fn config(State(state): State<Arc<AppState>>) -> Json<OidcConfigResponse> {
    Json(OidcConfigResponse {
        enabled: state.oidc.is_some(),
    })
}

fn configured(state: &AppState) -> Result<&Arc<Oidc>> {
    state
        .oidc
        .as_ref()
        .ok_or_else(|| Error::NotFound("OIDC sign-in is not configured".to_string()))
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty())
}

fn binding_cookie(oidc: &Oidc, value: &str, max_age: u32) -> HeaderValue {
    let secure = if oidc.config.secure_cookies() {
        "; Secure"
    } else {
        ""
    };
    HeaderValue::from_str(&format!(
        "{}={value}; Path=/api/auth/oidc; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}",
        oidc::BINDING_COOKIE
    ))
    .expect("cookie value is ASCII")
}

fn redirect(location: &str) -> Response {
    match HeaderValue::from_str(location) {
        Ok(location) => (
            StatusCode::SEE_OTHER,
            [
                (header::LOCATION, location),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            ],
        )
            .into_response(),
        Err(_) => (StatusCode::BAD_REQUEST, "Invalid redirect").into_response(),
    }
}

fn failure_page(status: StatusCode, message: &str) -> Response {
    (status, format!("Sign-in failed: {message}")).into_response()
}

/// GET /api/auth/oidc/start?redirect=<client uri>&challenge=<pkce>&prompt=<select_account|login>
pub async fn start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<OidcStartParams>,
) -> Response {
    let oidc = match configured(&state) {
        Ok(oidc) => oidc,
        Err(e) => return failure_page(StatusCode::NOT_FOUND, &e.to_string()),
    };
    if !oidc.config.is_allowed_redirect(&params.redirect) {
        tracing::warn!(redirect = %params.redirect, "OIDC start with a redirect that is not allowed");
        return failure_page(StatusCode::BAD_REQUEST, "redirect is not allowed");
    }
    let challenge = params.challenge.filter(|c| !c.is_empty());
    if let Some(challenge) = &challenge {
        if !oidc::is_valid_challenge(challenge) {
            return failure_page(StatusCode::BAD_REQUEST, "invalid challenge");
        }
    }
    let prompt = params.prompt.as_deref().and_then(|value| {
        let prompt = oidc::Prompt::parse(value);
        if prompt.is_none() {
            tracing::debug!(prompt = %value, "Ignoring an OIDC prompt that is not allowed");
        }
        prompt
    });
    // Reuse the browser's binding so sign-ins started in two tabs both work.
    let binding = cookie(&headers, oidc::BINDING_COOKIE)
        .filter(|value| {
            (32..=64).contains(&value.len())
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
        .map(str::to_string)
        .unwrap_or_else(oidc::random_token);

    match oidc
        .start(&binding, &params.redirect, challenge.as_deref(), prompt)
        .await
    {
        Ok(url) => {
            let mut response = redirect(&url);
            response
                .headers_mut()
                .insert(header::SET_COOKIE, binding_cookie(oidc, &binding, 600));
            response
        }
        Err(e) => {
            tracing::error!(error = %e, "OIDC sign-in could not start");
            redirect(&oidc::with_query(
                &params.redirect,
                &[("error", "The sign-in provider is unavailable")],
            ))
        }
    }
}

/// GET /api/auth/oidc/callback (the provider's redirect)
pub async fn callback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<OidcCallbackParams>,
) -> Response {
    let oidc = match configured(&state) {
        Ok(oidc) => oidc,
        Err(e) => return failure_page(StatusCode::NOT_FOUND, &e.to_string()),
    };
    let Some(login) = params
        .state
        .as_deref()
        .and_then(|state| oidc.take_pending(state, cookie(&headers, oidc::BINDING_COOKIE)))
    else {
        return failure_page(
            StatusCode::BAD_REQUEST,
            "the sign-in expired or was started in another browser. Please try again.",
        );
    };

    let result = match (&params.error, &params.code) {
        (Some(error), _) => Err(Error::Auth(
            params
                .error_description
                .clone()
                .unwrap_or_else(|| error.clone()),
        )),
        (None, Some(code)) => match oidc.finish(&login, code).await {
            Ok(identity) => sign_in_user(&state, oidc, &identity).await,
            Err(e) => Err(e),
        },
        (None, None) => Err(Error::Auth("the provider sent no code".to_string())),
    };

    let location = match result {
        Ok(user) => {
            tracing::info!(username = %user.username, method = "oidc", "User signed in");
            let code = oidc.issue_code(user.id, login.client_challenge.clone());
            oidc::with_query(&login.client_redirect, &[("code", &code)])
        }
        Err(e) => {
            tracing::warn!(error = %e, "OIDC sign-in failed");
            let message = match e {
                Error::Auth(message) | Error::Forbidden(message) => message,
                _ => "Sign-in failed on the server".to_string(),
            };
            oidc::with_query(&login.client_redirect, &[("error", &message)])
        }
    };
    let mut response = redirect(&location);
    response
        .headers_mut()
        .insert(header::SET_COOKIE, binding_cookie(oidc, "", 0));
    response
}

/// POST /api/auth/oidc/exchange {code, codeVerifier} → the normal login response
pub async fn exchange(
    State(state): State<Arc<AppState>>,
    Json(request): Json<OidcExchangeRequest>,
) -> FerrotuneApiResult<Json<AuthLoginResponse>> {
    let oidc = configured(&state)?;
    let user_id = oidc.redeem_code(&request.code, request.code_verifier.as_deref())?;
    let user = users_repo::get_user_by_id(&state.database, user_id)
        .await?
        .ok_or_else(|| Error::Auth("Invalid or expired sign-in code".to_string()))?;
    Ok(Json(
        issue_login(&state, user, request.client_name.as_deref()).await?,
    ))
}

/// Finds (or links, or creates) the local user for a provider account, and
/// applies the admin flag from the provider's groups.
async fn sign_in_user(state: &AppState, oidc: &Oidc, identity: &Identity) -> Result<User> {
    let database = &state.database;
    let mut user = match oidc_identities::find_user(database, &identity.issuer, &identity.subject)
        .await?
    {
        Some(user) => {
            oidc_identities::touch_login(database, &identity.issuer, &identity.subject).await?;
            user
        }
        None => {
            let user = link_or_create_user(state, oidc, identity).await?;
            oidc_identities::link(database, &identity.issuer, &identity.subject, user.id).await?;
            tracing::info!(
                username = %user.username,
                subject = %identity.subject,
                "Linked OIDC account to user"
            );
            user
        }
    };

    if let Some(is_admin) = oidc.admin_flag(identity) {
        if user.is_admin != is_admin {
            users_repo::update_user_admin_by_id(database, user.id, is_admin).await?;
            tracing::info!(username = %user.username, is_admin, "Admin flag set from OIDC groups");
            user.is_admin = is_admin;
        }
    }
    Ok(user)
}

async fn link_or_create_user(state: &AppState, oidc: &Oidc, identity: &Identity) -> Result<User> {
    let database = &state.database;
    let preferred = identity
        .preferred_username
        .as_deref()
        .ok_or_else(|| Error::Auth("the provider sent no username".to_string()))?;
    let username = oidc.config.local_username_for(preferred);

    let mut matches = users_repo::find_users_by_username_ci(database, &username).await?;
    let existing = if matches.len() > 1 {
        let exact = matches.iter().position(|user| user.username == username);
        Some(matches.swap_remove(exact.ok_or_else(|| {
            Error::Auth(format!(
                "several Ferrotune accounts are named like {username}; ask an admin to set FERROTUNE_OIDC_USER_MAP"
            ))
        })?))
    } else {
        matches.pop()
    };

    if let Some(user) = existing {
        if oidc_identities::user_has_identity(database, &identity.issuer, user.id).await? {
            return Err(Error::Forbidden(format!(
                "the Ferrotune account {} is already linked to another sign-in",
                user.username
            )));
        }
        return Ok(user);
    }

    let user_id = users_repo::create_user(
        database,
        &username,
        OIDC_ONLY_PASSWORD_HASH,
        identity.email.as_deref(),
        oidc.admin_flag(identity).unwrap_or(false),
    )
    .await?;
    let folder_ids = users_repo::get_music_folder_ids(database).await?;
    users_repo::replace_user_library_access(database, user_id, &folder_ids).await?;
    tracing::info!(username = %username, "Created user from OIDC sign-in");
    users_repo::get_user_by_id(database, user_id)
        .await?
        .ok_or_else(|| Error::Internal("created user vanished".to_string()))
}
