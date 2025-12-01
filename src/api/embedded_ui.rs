//! Embedded UI static file serving.
//!
//! This module provides a fallback handler for serving the embedded Next.js web client.
//! When the `embedded-ui` feature is enabled and the static files are present at
//! `client/out`, they will be compiled into the binary and served from the root path.

#[cfg(feature = "embedded-ui")]
use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode},
    response::IntoResponse,
};

#[cfg(feature = "embedded-ui")]
use rust_embed::RustEmbed;

/// Embedded static files from the Next.js export.
/// The path is relative to the Cargo.toml file.
/// Files will only be embedded if the `client/out` directory exists at compile time.
#[cfg(feature = "embedded-ui")]
#[derive(RustEmbed)]
#[folder = "client/out"]
#[include = "*.html"]
#[include = "*.js"]
#[include = "*.css"]
#[include = "*.json"]
#[include = "*.ico"]
#[include = "*.png"]
#[include = "*.svg"]
#[include = "*.txt"]
#[include = "*.woff"]
#[include = "*.woff2"]
#[include = "_next/**/*"]
struct EmbeddedAssets;

/// Check if embedded UI assets are available.
#[cfg(feature = "embedded-ui")]
pub fn has_embedded_ui() -> bool {
    // Check if at least index.html exists
    EmbeddedAssets::get("index.html").is_some()
}

/// Check if embedded UI assets are available.
#[cfg(not(feature = "embedded-ui"))]
pub fn has_embedded_ui() -> bool {
    false
}

/// Fallback handler for serving embedded static files.
/// Returns the appropriate static file or falls back to index.html for SPA routing.
#[cfg(feature = "embedded-ui")]
pub async fn serve_embedded_ui(request: Request<Body>) -> impl IntoResponse {
    let path = request.uri().path();
    
    // Strip leading slash
    let path = path.trim_start_matches('/');
    
    // Try to serve the exact file first
    if let Some(file) = EmbeddedAssets::get(path) {
        return serve_file(path, file.data.as_ref());
    }
    
    // For directory paths, try index.html
    let index_path = if path.is_empty() {
        "index.html".to_string()
    } else {
        format!("{}/index.html", path)
    };
    
    if let Some(file) = EmbeddedAssets::get(&index_path) {
        return serve_file(&index_path, file.data.as_ref());
    }
    
    // Try with .html extension for Next.js static routes
    let html_path = format!("{}.html", path);
    if let Some(file) = EmbeddedAssets::get(&html_path) {
        return serve_file(&html_path, file.data.as_ref());
    }
    
    // For SPA routing, fall back to root index.html
    // This allows client-side routing to work
    if !path.starts_with("_next/") && !path.contains('.') {
        if let Some(file) = EmbeddedAssets::get("index.html") {
            return serve_file("index.html", file.data.as_ref());
        }
    }
    
    // File not found
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("Not Found"))
        .unwrap()
}

#[cfg(feature = "embedded-ui")]
fn serve_file(path: &str, data: &[u8]) -> Response<Body> {
    // Guess content type from file extension
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    
    // Determine cache headers
    // _next/ assets are hashed and can be cached indefinitely
    // Other files should be revalidated
    let cache_control = if path.starts_with("_next/") {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=0, must-revalidate"
    };
    
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .body(Body::from(data.to_vec()))
        .unwrap()
}
