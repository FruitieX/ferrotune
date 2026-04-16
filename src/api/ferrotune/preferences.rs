//! User preferences API endpoints.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::queries;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

/// User preferences response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PreferencesResponse {
    pub accent_color: String,
    pub custom_accent_hue: Option<f64>,
    pub custom_accent_lightness: Option<f64>,
    pub custom_accent_chroma: Option<f64>,
    /// Generic JSON preferences for client-side settings
    #[ts(type = "Record<string, unknown>")]
    pub preferences: HashMap<String, Value>,
}

/// Update preferences request (for accent color)
#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdatePreferencesRequest {
    pub accent_color: String,
    pub custom_accent_hue: Option<f64>,
    pub custom_accent_lightness: Option<f64>,
    pub custom_accent_chroma: Option<f64>,
}

/// Update a single generic preference
#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SetPreferenceRequest {
    #[ts(type = "unknown")]
    pub value: Value,
}

/// Response for getting a single preference
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetPreferenceResponse {
    pub key: String,
    #[ts(type = "unknown | null")]
    pub value: Option<Value>,
}

/// Get user preferences
pub async fn get_preferences(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<PreferencesResponse>> {
    let prefs = queries::get_user_preferences(&state.database, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get user preferences: {}", e)))?;

    match prefs {
        Some(prefs) => {
            // Parse preferences_json
            let preferences: HashMap<String, Value> =
                serde_json::from_str(&prefs.preferences_json).unwrap_or_default();

            Ok(Json(PreferencesResponse {
                accent_color: prefs.accent_color,
                custom_accent_hue: prefs.custom_accent_hue,
                custom_accent_lightness: prefs.custom_accent_lightness,
                custom_accent_chroma: prefs.custom_accent_chroma,
                preferences,
            }))
        }
        None => {
            // Return defaults if no preferences set
            Ok(Json(PreferencesResponse {
                accent_color: "rust".to_string(),
                custom_accent_hue: None,
                custom_accent_lightness: None,
                custom_accent_chroma: None,
                preferences: HashMap::new(),
            }))
        }
    }
}

/// Update user preferences (accent color)
pub async fn update_preferences(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdatePreferencesRequest>,
) -> FerrotuneApiResult<Json<PreferencesResponse>> {
    // Validate accent_color is a valid preset or "custom"
    let valid_colors = [
        "rust", "gold", "lime", "emerald", "teal", "ocean", "indigo", "violet", "rose", "crimson",
        "custom",
    ];

    if !valid_colors.contains(&request.accent_color.as_str()) {
        return Err(Error::InvalidRequest(format!(
            "Invalid accent color: {}",
            request.accent_color
        ))
        .into());
    }

    // Validate custom_accent_hue if provided
    if let Some(hue) = request.custom_accent_hue {
        if !(0.0..=360.0).contains(&hue) {
            return Err(Error::InvalidRequest(
                "custom_accent_hue must be between 0 and 360".to_string(),
            )
            .into());
        }
    }

    // Validate custom_accent_lightness if provided
    if let Some(lightness) = request.custom_accent_lightness {
        if !(0.0..=1.0).contains(&lightness) {
            return Err(Error::InvalidRequest(
                "custom_accent_lightness must be between 0 and 1".to_string(),
            )
            .into());
        }
    }

    // Validate custom_accent_chroma if provided
    if let Some(chroma) = request.custom_accent_chroma {
        if !(0.0..=0.5).contains(&chroma) {
            return Err(Error::InvalidRequest(
                "custom_accent_chroma must be between 0 and 0.5".to_string(),
            )
            .into());
        }
    }

    // Get existing preferences to preserve preferences_json
    let existing_prefs = queries::get_user_preferences(&state.database, user.user_id)
        .await
        .ok()
        .flatten();
    let preferences: HashMap<String, Value> = existing_prefs
        .as_ref()
        .and_then(|p| serde_json::from_str(&p.preferences_json).ok())
        .unwrap_or_default();

    queries::upsert_user_preferences(
        &state.database,
        user.user_id,
        &request.accent_color,
        request.custom_accent_hue,
        request.custom_accent_lightness,
        request.custom_accent_chroma,
        existing_prefs
            .as_ref()
            .map(|p| p.preferences_json.as_str())
            .unwrap_or("{}"),
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to update user preferences: {}", e)))?;

    Ok(Json(PreferencesResponse {
        accent_color: request.accent_color,
        custom_accent_hue: request.custom_accent_hue,
        custom_accent_lightness: request.custom_accent_lightness,
        custom_accent_chroma: request.custom_accent_chroma,
        preferences,
    }))
}

/// Get a single preference by key
pub async fn get_preference(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> FerrotuneApiResult<Json<GetPreferenceResponse>> {
    let prefs = queries::get_user_preferences(&state.database, user.user_id)
        .await
        .map_err(|e| Error::Internal(format!("Failed to get preference: {}", e)))?;

    match prefs {
        Some(prefs) => {
            let preferences: HashMap<String, Value> =
                serde_json::from_str(&prefs.preferences_json).unwrap_or_default();
            let value = preferences.get(&key).cloned();

            Ok(Json(GetPreferenceResponse { key, value }))
        }
        None => Ok(Json(GetPreferenceResponse { key, value: None })),
    }
}

/// Set a single preference by key
pub async fn set_preference(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
    Json(request): Json<SetPreferenceRequest>,
) -> FerrotuneApiResult<Json<GetPreferenceResponse>> {
    // Get existing preferences
    let existing = queries::get_user_preferences(&state.database, user.user_id)
        .await
        .ok()
        .flatten();

    let mut preferences: HashMap<String, Value> = existing
        .as_ref()
        .and_then(|p| serde_json::from_str(&p.preferences_json).ok())
        .unwrap_or_default();

    // Update the preference
    preferences.insert(key.clone(), request.value.clone());

    let preferences_json = serde_json::to_string(&preferences).unwrap_or_else(|_| "{}".to_string());

    // Get existing accent color settings or defaults
    let accent_color = existing
        .as_ref()
        .map(|p| p.accent_color.clone())
        .unwrap_or_else(|| "rust".to_string());
    let custom_accent_hue = existing.as_ref().and_then(|p| p.custom_accent_hue);
    let custom_accent_lightness = existing.as_ref().and_then(|p| p.custom_accent_lightness);
    let custom_accent_chroma = existing.as_ref().and_then(|p| p.custom_accent_chroma);

    queries::upsert_user_preferences(
        &state.database,
        user.user_id,
        &accent_color,
        custom_accent_hue,
        custom_accent_lightness,
        custom_accent_chroma,
        &preferences_json,
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to set preference: {}", e)))?;

    Ok(Json(GetPreferenceResponse {
        key,
        value: Some(request.value),
    }))
}

/// Delete a single preference by key
pub async fn delete_preference(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> FerrotuneApiResult<StatusCode> {
    // Get existing preferences
    let existing = queries::get_user_preferences(&state.database, user.user_id)
        .await
        .ok()
        .flatten();

    let mut preferences: HashMap<String, Value> = existing
        .as_ref()
        .and_then(|p| serde_json::from_str(&p.preferences_json).ok())
        .unwrap_or_default();

    // Remove the preference
    let removed = preferences.remove(&key);

    if removed.is_none() {
        return Ok(StatusCode::NO_CONTENT);
    }

    let preferences_json = serde_json::to_string(&preferences).unwrap_or_else(|_| "{}".to_string());

    // Get existing accent color settings or defaults
    let accent_color = existing
        .as_ref()
        .map(|p| p.accent_color.clone())
        .unwrap_or_else(|| "rust".to_string());
    let custom_accent_hue = existing.as_ref().and_then(|p| p.custom_accent_hue);
    let custom_accent_lightness = existing.as_ref().and_then(|p| p.custom_accent_lightness);
    let custom_accent_chroma = existing.as_ref().and_then(|p| p.custom_accent_chroma);

    queries::upsert_user_preferences(
        &state.database,
        user.user_id,
        &accent_color,
        custom_accent_hue,
        custom_accent_lightness,
        custom_accent_chroma,
        &preferences_json,
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to delete preference: {}", e)))?;

    Ok(StatusCode::NO_CONTENT)
}
