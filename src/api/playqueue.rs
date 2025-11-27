use crate::api::auth::AuthenticatedUser;
use crate::api::response::{format_ok_empty, FormatResponse};
use crate::api::QsQuery;
use crate::api::{first_string_or_none, string_or_seq};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlayQueueParams {
    #[serde(default, deserialize_with = "string_or_seq")]
    id: Vec<String>,
    #[serde(default, deserialize_with = "first_string_or_none")]
    current: Option<String>,
    #[serde(default, deserialize_with = "crate::api::query::first_i64_or_none")]
    position: Option<i64>,
}

#[derive(Serialize)]
pub struct PlayQueueResponse {
    #[serde(rename = "playQueue")]
    pub play_queue: PlayQueueContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayQueueContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    pub entry: Vec<crate::api::browse::SongResponse>,
}

/// GET /rest/savePlayQueue - Save the current play queue
pub async fn save_play_queue(
    user: AuthenticatedUser,
    State(_state): State<Arc<AppState>>,
    QsQuery(_params): QsQuery<SavePlayQueueParams>,
) -> Result<impl axum::response::IntoResponse> {
    // TODO: Implement play queue persistence
    // For now, just return success without saving
    Ok(format_ok_empty(user.format))
}

/// GET /rest/getPlayQueue - Get the saved play queue
pub async fn get_play_queue(
    user: AuthenticatedUser,
    State(_state): State<Arc<AppState>>,
) -> Result<FormatResponse<PlayQueueResponse>> {
    let response = PlayQueueResponse {
        play_queue: PlayQueueContent {
            current: None,
            position: None,
            username: None,
            changed: None,
            changed_by: None,
            entry: vec![],
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
