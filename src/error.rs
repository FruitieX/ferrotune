use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::api::subsonic::xml::{self, ResponseFormat, XmlError, XmlErrorResponse};

pub type Result<T> = std::result::Result<T, Error>;

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
    Database(#[from] sqlx::Error),

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

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),
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
    fn to_code_and_message(&self) -> (StatusCode, u32, String) {
        match self {
            Error::Auth(msg) => (StatusCode::UNAUTHORIZED, 40, msg.clone()),
            Error::TokenAuthNotSupported => (
                StatusCode::UNAUTHORIZED,
                41,
                "Token authentication not supported for this user".to_string(),
            ),
            Error::AuthMechanismNotSupported => (
                StatusCode::UNAUTHORIZED,
                42,
                "Provided authentication mechanism not supported".to_string(),
            ),
            Error::ConflictingAuthParams => (
                StatusCode::BAD_REQUEST,
                43,
                "Multiple conflicting authentication mechanisms provided".to_string(),
            ),
            Error::InvalidApiKey => (StatusCode::UNAUTHORIZED, 44, "Invalid API key".to_string()),
            Error::NotFound(msg) => (StatusCode::NOT_FOUND, 70, msg.clone()),
            Error::InvalidRequest(msg) => (StatusCode::BAD_REQUEST, 10, msg.clone()),
            Error::Database(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("Database error: {}", e),
            ),
            Error::Io(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("IO error: {}", e),
            ),
            Error::Image(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("Image error: {}", e),
            ),
            Error::Lofty(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("Metadata error: {}", e),
            ),
            Error::Config(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("Configuration error: {}", e),
            ),
            Error::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, 0, msg.clone()),
            Error::Migration(ref msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                0,
                format!("Migration error: {}", msg),
            ),
        }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        // Default to JSON when format is unknown (Error doesn't carry format info)
        // Use FormatError for format-aware error responses
        tracing::warn!(error = %self, "API error response");

        let (status, code, message) = self.to_code_and_message();

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

        (status, Json(error_response)).into_response()
    }
}

impl IntoResponse for FormatError {
    fn into_response(self) -> Response {
        tracing::warn!(error = %self.error, format = ?self.format, "API error response");

        let (status, code, message) = self.error.to_code_and_message();

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
                (status, Json(error_response)).into_response()
            }
            ResponseFormat::Xml => {
                let xml_response = XmlErrorResponse::failed(XmlError { code, message });
                match xml::to_xml_string(&xml_response) {
                    Ok(xml_str) => (
                        status,
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
