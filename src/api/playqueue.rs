use crate::api::auth::AuthenticatedUser;
use crate::api::response::{format_ok_empty, FormatResponse};
use crate::api::xml::{XmlPlayQueueInner, XmlPlayQueueResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlayQueueParams {
    id: Option<Vec<String>>,
    current: Option<String>,
    position: Option<i64>,
}

#[derive(Serialize)]
pub struct PlayQueueResponse {
    #[serde(rename = "playQueue")]
    play_queue: PlayQueueContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayQueueContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    changed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    changed_by: Option<String>,
    entry: Vec<crate::api::browse::SongResponse>,
}

/// GET /rest/savePlayQueue - Save the current play queue
pub async fn save_play_queue(
    user: AuthenticatedUser,
    State(_state): State<Arc<AppState>>,
    Query(_params): Query<SavePlayQueueParams>,
) -> Result<impl axum::response::IntoResponse> {
    // TODO: Implement play queue persistence
    // For now, just return success without saving
    Ok(format_ok_empty(user.format))
}

/// GET /rest/getPlayQueue - Get the saved play queue
pub async fn get_play_queue(
    user: AuthenticatedUser,
    State(_state): State<Arc<AppState>>,
) -> Result<FormatResponse<PlayQueueResponse, XmlPlayQueueResponse>> {
    let json_response = PlayQueueResponse {
        play_queue: PlayQueueContent {
            current: None,
            position: None,
            username: None,
            changed: None,
            changed_by: None,
            entry: vec![],
        },
    };
    
    let xml_response = XmlPlayQueueResponse::ok(XmlPlayQueueInner {
        current: None,
        position: None,
        username: None,
        changed: None,
        changed_by: None,
        entry: vec![],
    });
    
    Ok(FormatResponse::new(user.format, json_response, xml_response))
}
