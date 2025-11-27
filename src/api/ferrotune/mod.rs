//! Ferrotune Admin API.
//!
//! This module provides administrative endpoints for managing the Ferrotune server.
//! Unlike the OpenSubsonic API, this API uses modern REST conventions with JSON
//! request/response bodies and proper HTTP methods.
//!
//! ## Authentication
//!
//! All endpoints require authentication using the same credentials as the
//! OpenSubsonic API. Pass credentials via HTTP Basic Auth or as query parameters
//! (`u` for username, `p` for password).
//!
//! ## Endpoints
//!
//! - `GET /api/health` - Health check
//! - `POST /api/scan` - Trigger a library scan
//! - `GET /api/scan/status` - Get current scan status (placeholder for future async scanning)

mod scan;

use crate::api::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::Serialize;
use std::sync::Arc;

/// Create the Ferrotune Admin API router.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/scan", post(scan::start_scan))
        .route("/api/scan/status", get(scan::scan_status))
        .with_state(state)
}

/// Health check response.
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// Simple health check endpoint.
async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Standard error response for the admin API.
#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl ErrorResponse {
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: None,
        }
    }

    pub fn with_details(error: impl Into<String>, details: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: Some(details.into()),
        }
    }
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}
