//! User preferences API endpoints.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::queries;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
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
}

/// Update preferences request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub accent_color: String,
    pub custom_accent_hue: Option<f64>,
    pub custom_accent_lightness: Option<f64>,
    pub custom_accent_chroma: Option<f64>,
}

/// Get user preferences
pub async fn get_preferences(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match queries::get_user_preferences(&state.pool, user.user_id).await {
        Ok(Some(prefs)) => Json(PreferencesResponse {
            accent_color: prefs.accent_color,
            custom_accent_hue: prefs.custom_accent_hue,
            custom_accent_lightness: prefs.custom_accent_lightness,
            custom_accent_chroma: prefs.custom_accent_chroma,
        })
        .into_response(),
        Ok(None) => {
            // Return defaults if no preferences set
            Json(PreferencesResponse {
                accent_color: "rust".to_string(),
                custom_accent_hue: None,
                custom_accent_lightness: None,
                custom_accent_chroma: None,
            })
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to get user preferences");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new("Failed to get preferences")),
            )
                .into_response()
        }
    }
}

/// Update user preferences
pub async fn update_preferences(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdatePreferencesRequest>,
) -> impl IntoResponse {
    // Validate accent_color is a valid preset or "custom"
    let valid_colors = [
        "rust", "gold", "lime", "emerald", "teal", "ocean", "indigo", "violet", "rose", "crimson",
        "custom",
    ];

    if !valid_colors.contains(&request.accent_color.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse::new(format!(
                "Invalid accent color: {}",
                request.accent_color
            ))),
        )
            .into_response();
    }

    // Validate custom_accent_hue if provided
    if let Some(hue) = request.custom_accent_hue {
        if !(0.0..=360.0).contains(&hue) {
            return (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse::new(
                    "custom_accent_hue must be between 0 and 360",
                )),
            )
                .into_response();
        }
    }

    // Validate custom_accent_lightness if provided
    if let Some(lightness) = request.custom_accent_lightness {
        if !(0.0..=1.0).contains(&lightness) {
            return (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse::new(
                    "custom_accent_lightness must be between 0 and 1",
                )),
            )
                .into_response();
        }
    }

    // Validate custom_accent_chroma if provided
    if let Some(chroma) = request.custom_accent_chroma {
        if !(0.0..=0.5).contains(&chroma) {
            return (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse::new(
                    "custom_accent_chroma must be between 0 and 0.5",
                )),
            )
                .into_response();
        }
    }

    match queries::upsert_user_preferences(
        &state.pool,
        user.user_id,
        &request.accent_color,
        request.custom_accent_hue,
        request.custom_accent_lightness,
        request.custom_accent_chroma,
    )
    .await
    {
        Ok(()) => Json(PreferencesResponse {
            accent_color: request.accent_color,
            custom_accent_hue: request.custom_accent_hue,
            custom_accent_lightness: request.custom_accent_lightness,
            custom_accent_chroma: request.custom_accent_chroma,
        })
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to update user preferences");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new("Failed to update preferences")),
            )
                .into_response()
        }
    }
}
