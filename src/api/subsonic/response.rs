use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use super::xml::{self, ResponseFormat, ToXml, XmlEmptyResponse};

/// JSON wrapper for subsonic-response
#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct SubsonicResponse<T: Serialize> {
    pub subsonic_response: ResponseInner<T>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseInner<T: Serialize> {
    pub status: String,
    pub version: String,
    #[serde(rename = "type")]
    pub response_type: String,
    pub server_version: String,
    #[serde(rename = "openSubsonic")]
    pub open_subsonic: bool,
    #[serde(flatten)]
    pub data: T,
}

impl<T: Serialize> SubsonicResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            subsonic_response: ResponseInner {
                status: "ok".to_string(),
                version: "1.16.1".to_string(),
                response_type: "ferrotune".to_string(),
                server_version: env!("CARGO_PKG_VERSION").to_string(),
                open_subsonic: true,
                data,
            },
        }
    }
}

impl<T: Serialize> IntoResponse for SubsonicResponse<T> {
    fn into_response(self) -> Response {
        // Always return JSON - format-aware response uses FormatResponse
        Json(self).into_response()
    }
}

// Empty response for endpoints that don't return data
#[derive(Serialize)]
pub struct EmptyResponse {}

pub fn ok_empty() -> SubsonicResponse<EmptyResponse> {
    SubsonicResponse::ok(EmptyResponse {})
}

/// A format-aware response that serializes to JSON or XML.
///
/// The type `T` must implement both `Serialize` (for JSON) and `ToXml` (for XML).
/// When the format is XML, `T::to_xml()` is called to get the XML representation.
pub struct FormatResponse<T: Serialize + ToXml> {
    pub format: ResponseFormat,
    pub data: T,
}

impl<T: Serialize + ToXml> FormatResponse<T> {
    pub fn new(format: ResponseFormat, data: T) -> Self {
        Self { format, data }
    }
}

impl<T: Serialize + ToXml> IntoResponse for FormatResponse<T> {
    fn into_response(self) -> Response {
        match self.format {
            ResponseFormat::Json | ResponseFormat::Jsonp => {
                let json_response = SubsonicResponse::ok(self.data);
                (
                    [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
                    Json(json_response),
                )
                    .into_response()
            }
            ResponseFormat::Xml => {
                let xml_response = self.data.to_xml();
                match xml::to_xml_string(&xml_response) {
                    Ok(xml_str) => (
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

/// Empty format-aware response for endpoints that don't return data
pub struct FormatEmptyResponse {
    pub format: ResponseFormat,
}

impl FormatEmptyResponse {
    pub fn new(format: ResponseFormat) -> Self {
        Self { format }
    }
}

impl IntoResponse for FormatEmptyResponse {
    fn into_response(self) -> Response {
        match self.format {
            ResponseFormat::Json | ResponseFormat::Jsonp => {
                let json_response = SubsonicResponse::ok(EmptyResponse {});
                (
                    [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
                    Json(json_response),
                )
                    .into_response()
            }
            ResponseFormat::Xml => {
                let xml_response = XmlEmptyResponse::ok();
                match xml::to_xml_string(&xml_response) {
                    Ok(xml_str) => (
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

/// Helper to create empty format-aware responses
pub fn format_ok_empty(format: ResponseFormat) -> FormatEmptyResponse {
    FormatEmptyResponse::new(format)
}
