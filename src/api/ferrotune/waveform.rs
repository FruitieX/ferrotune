//! Waveform generation endpoint.
//!
//! Provides pre-computed waveform data from the database (computed during scanning).

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// Response for pre-computed waveform data.
#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct WaveformResponse {
    /// Normalized heights for display (0.15 to 1.0), pre-computed during scanning.
    pub heights: Vec<f32>,
}

/// Get pre-computed waveform data for a song.
///
/// Returns waveform heights that were computed during library scanning.
/// Returns 404 if no waveform data has been computed for this song yet.
pub async fn get_waveform(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> FerrotuneApiResult<Json<WaveformResponse>> {
    // Check user has access
    if !crate::api::ferrotune::users::user_has_song_access(&state.database, user.user_id, &song_id)
        .await?
    {
        return Err(Error::Forbidden(format!("You do not have access to song {}", song_id)).into());
    }

    // Get waveform data from database
    #[derive(sea_orm::FromQueryResult)]
    struct WaveformRow {
        waveform_data: Vec<u8>,
    }
    let row = crate::db::raw::query_one::<WaveformRow>(
        state.database.conn(),
        "SELECT waveform_data FROM songs WHERE id = ? AND waveform_data IS NOT NULL",
        "SELECT waveform_data FROM songs WHERE id = $1 AND waveform_data IS NOT NULL",
        [sea_orm::Value::from(song_id.clone())],
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to query waveform: {}", e)))?;

    let blob = row
        .ok_or_else(|| Error::NotFound(format!("No waveform data for song {}", song_id)))?
        .waveform_data;

    let heights = crate::analysis::blob_to_waveform(&blob)?;

    Ok(Json(WaveformResponse { heights }))
}
