// Some error types are prepared for future use
#![allow(dead_code)]

use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::api::subsonic::xml::{self, ResponseFormat, XmlError, XmlErrorResponse};

pub type Result<T> = std::result::Result<T, Error>;

/// Result type for Ferrotune Admin API endpoints.
/// Unlike Result<T, Error> which returns HTTP 200 per Subsonic spec,
/// this returns proper HTTP status codes for REST API responses.
pub type FerrotuneApiResult<T> = std::result::Result<T, FerrotuneApiError>;

/// Error wrapper for Ferrotune Admin API that uses proper HTTP status codes.
/// The inner Error type is used for error details, but IntoResponse
/// returns proper HTTP status codes instead of HTTP 200.
#[derive(Debug)]
pub struct FerrotuneApiError(pub Error);

impl std::fmt::Display for FerrotuneApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for FerrotuneApiError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

impl From<Error> for FerrotuneApiError {
    fn from(e: Error) -> Self {
        FerrotuneApiError(e)
    }
}

impl From<sea_orm::DbErr> for FerrotuneApiError {
    fn from(e: sea_orm::DbErr) -> Self {
        FerrotuneApiError(Error::Orm(e))
    }
}

impl From<std::io::Error> for FerrotuneApiError {
    fn from(e: std::io::Error) -> Self {
        FerrotuneApiError(Error::Io(e))
    }
}

impl From<FerrotuneApiError> for Error {
    fn from(e: FerrotuneApiError) -> Self {
        e.0
    }
}

/// Extension trait to convert Result<T, Error> to FerrotuneApiResult<T>
/// This allows using `result.api_err()` to convert errors.
pub trait ResultExt<T> {
    /// Convert this Result into a FerrotuneApiResult
    fn api_err(self) -> FerrotuneApiResult<T>;
}

impl<T> ResultExt<T> for Result<T> {
    fn api_err(self) -> FerrotuneApiResult<T> {
        self.map_err(FerrotuneApiError::from)
    }
}

/// Helper to quickly wrap an Error into FerrotuneApiError
pub fn api_err<T>(error: Error) -> FerrotuneApiResult<T> {
    Err(FerrotuneApiError(error))
}

/// Error with associated response format
pub struct FormatError {
    pub error: Error,
    pub format: ResponseFormat,
}

impl FormatError {
    pub fn new(error: Error, format: ResponseFormat) -> Self {
        Self { error, format }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Database error: {0}")]
    Orm(#[from] sea_orm::DbErr),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(#[from] config::ConfigError),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Audio metadata error: {0}")]
    Lofty(#[from] lofty::error::LoftyError),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Token authentication not supported for this user")]
    TokenAuthNotSupported,

    #[error("Provided authentication mechanism not supported")]
    AuthMechanismNotSupported,

    #[error("Multiple conflicting authentication mechanisms provided")]
    ConflictingAuthParams,

    #[error("Invalid API key")]
    InvalidApiKey,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Conflict: {0}")]
    Conflict(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubsonicError {
    code: u32,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
struct SubsonicResponse {
    subsonic_response: SubsonicErrorResponse,
}

#[derive(Serialize)]
struct SubsonicErrorResponse {
    status: String,
    version: String,
    #[serde(rename = "type")]
    response_type: String,
    #[serde(rename = "serverVersion")]
    server_version: String,
    #[serde(rename = "openSubsonic")]
    open_subsonic: bool,
    error: SubsonicError,
}

impl Error {
    /// Get the Subsonic error code and message for this error.
    /// Note: Per the Subsonic API specification, errors are returned with HTTP 200
    /// and the error details in the response body.
    fn to_subsonic_error(&self) -> (u32, String) {
        match self {
            // Client-facing errors: safe to expose messages to API consumers
            Error::Auth(msg) => (40, msg.clone()),
            Error::TokenAuthNotSupported => (
                41,
                "Token authentication not supported for this user".to_string(),
            ),
            Error::AuthMechanismNotSupported => (
                42,
                "Provided authentication mechanism not supported".to_string(),
            ),
            Error::ConflictingAuthParams => (
                43,
                "Multiple conflicting authentication mechanisms provided".to_string(),
            ),
            Error::InvalidApiKey => (44, "Invalid API key".to_string()),
            Error::NotFound(msg) => (70, msg.clone()),
            Error::Forbidden(msg) => (50, msg.clone()),
            Error::InvalidRequest(msg) => (10, msg.clone()),
            Error::Conflict(msg) => (0, msg.clone()),
            // Internal errors: log details server-side, return generic message to client
            Error::Database(ref e) => {
                tracing::error!(error = %e, "Database error");
                (0, "Internal server error".to_string())
            }
            Error::Orm(ref e) => {
                tracing::error!(error = %e, "Database error (SeaORM)");
                (0, "Internal server error".to_string())
            }
            Error::Io(ref e) => {
                tracing::error!(error = %e, "IO error");
                (0, "Internal server error".to_string())
            }
            Error::Image(ref e) => {
                tracing::error!(error = %e, "Image processing error");
                (0, "Internal server error".to_string())
            }
            Error::Lofty(ref e) => {
                tracing::error!(error = %e, "Audio metadata error");
                (0, "Internal server error".to_string())
            }
            Error::Config(ref e) => {
                tracing::error!(error = %e, "Configuration error");
                (0, "Internal server error".to_string())
            }
            Error::Internal(ref msg) => {
                tracing::error!(error = %msg, "Internal error");
                (0, "Internal server error".to_string())
            }
            Error::Migration(ref msg) => {
                tracing::error!(error = %msg, "Migration error");
                (0, "Internal server error".to_string())
            }
        }
    }

    /// Get the HTTP status code for this error (for REST APIs like Ferrotune Admin API).
    pub fn to_http_status(&self) -> StatusCode {
        match self {
            Error::Auth(_)
            | Error::TokenAuthNotSupported
            | Error::AuthMechanismNotSupported
            | Error::InvalidApiKey => StatusCode::UNAUTHORIZED,
            Error::ConflictingAuthParams | Error::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Error::NotFound(_) => StatusCode::NOT_FOUND,
            Error::Conflict(_) => StatusCode::CONFLICT,
            Error::Forbidden(_) => StatusCode::FORBIDDEN,
            Error::Database(_)
            | Error::Orm(_)
            | Error::Io(_)
            | Error::Image(_)
            | Error::Lofty(_)
            | Error::Config(_)
            | Error::Internal(_)
            | Error::Migration(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// Simple JSON error response for Ferrotune Admin API
#[derive(Serialize)]
struct FerrotuneErrorResponse {
    error: String,
}

impl IntoResponse for FerrotuneApiError {
    fn into_response(self) -> Response {
        let status = self.0.to_http_status();

        // For internal errors, log details server-side and return generic message
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self.0, "Ferrotune API internal error");
            "Internal server error".to_string()
        } else {
            tracing::warn!(error = %self.0, "Ferrotune API error response");
            self.0.to_string()
        };

        (status, Json(FerrotuneErrorResponse { error: message })).into_response()
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        // Per the Subsonic API specification, errors are returned with HTTP 200
        // and the error details in the response body.
        // Default to JSON when format is unknown (Error doesn't carry format info)
        // Use FormatError for format-aware error responses
        tracing::warn!(error = %self, "API error response");

        let (code, message) = self.to_subsonic_error();

        let error_response = SubsonicResponse {
            subsonic_response: SubsonicErrorResponse {
                status: "failed".to_string(),
                version: "1.16.1".to_string(),
                response_type: "ferrotune".to_string(),
                server_version: env!("CARGO_PKG_VERSION").to_string(),
                open_subsonic: true,
                error: SubsonicError { code, message },
            },
        };

        // Always return HTTP 200 per Subsonic spec
        (StatusCode::OK, Json(error_response)).into_response()
    }
}

impl IntoResponse for FormatError {
    fn into_response(self) -> Response {
        // Per the Subsonic API specification, errors are returned with HTTP 200
        // and the error details in the response body.
        tracing::warn!(error = %self.error, format = ?self.format, "API error response");

        let (code, message) = self.error.to_subsonic_error();

        match self.format {
            ResponseFormat::Json | ResponseFormat::Jsonp => {
                let error_response = SubsonicResponse {
                    subsonic_response: SubsonicErrorResponse {
                        status: "failed".to_string(),
                        version: "1.16.1".to_string(),
                        response_type: "ferrotune".to_string(),
                        server_version: env!("CARGO_PKG_VERSION").to_string(),
                        open_subsonic: true,
                        error: SubsonicError { code, message },
                    },
                };
                // Always return HTTP 200 per Subsonic spec
                (StatusCode::OK, Json(error_response)).into_response()
            }
            ResponseFormat::Xml => {
                let xml_response = XmlErrorResponse::failed(XmlError { code, message });
                match xml::to_xml_string(&xml_response) {
                    Ok(xml_str) => (
                        // Always return HTTP 200 per Subsonic spec
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
                        xml_str,
                    )
                        .into_response(),
                    Err(e) => {
                        tracing::error!("XML serialization error: {}", e);
                        (StatusCode::INTERNAL_SERVER_ERROR, "XML serialization error")
                            .into_response()
                    }
                }
            }
        }
    }
}
