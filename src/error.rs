// Some error types are prepared for future use
#![allow(dead_code)]

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

/// Result type for API endpoints.
pub type FerrotuneApiResult<T> = std::result::Result<T, FerrotuneApiError>;

/// Error wrapper for API endpoints that use HTTP status codes.
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

/// Extension trait to convert Result<T, Error> to FerrotuneApiResult<T>.
pub trait ResultExt<T> {
    fn api_err(self) -> FerrotuneApiResult<T>;
}

impl<T> ResultExt<T> for Result<T> {
    fn api_err(self) -> FerrotuneApiResult<T> {
        self.map_err(FerrotuneApiError::from)
    }
}

pub fn api_err<T>(error: Error) -> FerrotuneApiResult<T> {
    Err(FerrotuneApiError(error))
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
    Config(String),

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

impl Error {
    pub fn to_http_status(&self) -> StatusCode {
        match self {
            Error::Auth(_) | Error::TokenAuthNotSupported | Error::AuthMechanismNotSupported => {
                StatusCode::UNAUTHORIZED
            }
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

    fn response_message(&self) -> String {
        if self.to_http_status() == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %self, "API internal error");
            "Internal server error".to_string()
        } else {
            tracing::warn!(error = %self, "API error response");
            self.to_string()
        }
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

impl IntoResponse for FerrotuneApiError {
    fn into_response(self) -> Response {
        self.0.into_response()
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = self.to_http_status();
        let message = self.response_message();
        (status, Json(ErrorResponse { error: message })).into_response()
    }
}
