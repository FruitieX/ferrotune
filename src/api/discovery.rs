//! Discovery endpoint — recommends songs similar to the user's listening history.
//!
//! Uses the user's most-recently-played song as a seed, finds acoustically
//! similar candidates via bliss, and excludes songs played recently so the
//! user is surfaced tracks they haven't heard lately.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::SongPlayStats;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::error::FerrotuneApiResult;
use crate::thumbnails::ThumbnailSize;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Query params for the discovery endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryParams {
    pub size: Option<i64>,
    pub offset: Option<i64>,
    pub inline_images: Option<String>,
    /// Number of results to request from bliss (before pagination, default 30)
    pub count: Option<i64>,
    /// Days to look back for "recently played" exclusion (default 7)
    pub exclude_recent_days: Option<i64>,
    /// Optional seed for deterministic shuffle. The response echoes the seed
    /// so the client can materialize the same queue later.
    pub seed: Option<i64>,
    /// Optional seed song ID override. When omitted, the server picks the
    /// most-recently-played song. The response echoes the resolved seed song
    /// ID so the client can forward it when materializing a playback queue
    /// (otherwise a changed scrobble history could pick a different seed
    /// song and produce a different "similar tracks" list).
    pub seed_song_id: Option<String>,
}

/// Response for the discovery endpoint
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DiscoveryResponse {
    pub song: Vec<crate::api::common::models::SongResponse>,
    #[ts(type = "number")]
    pub total: i64,
    /// Seed used for the deterministic shuffle so the client can replay the
    /// same list when starting playback.
    #[ts(type = "number")]
    pub seed: i64,
    /// Number of candidates requested from bliss (mirrors the request).
    #[ts(type = "number")]
    pub count: i64,
    /// Days used for the "recently played" exclusion window (mirrors the request).
    #[ts(type = "number")]
    pub exclude_recent_days: i64,
    /// Seed song ID used to compute similarity. Mirrors the request, falling
    /// back to the most-recently-played scrobble when omitted. Forwarded back
    /// when materializing playback queues so the rendered list matches.
    pub seed_song_id: Option<String>,
}

/// GET /api/discovery/similar-songs
pub async fn get_similar_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<DiscoveryParams>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let size = params.size.unwrap_or(30).min(200);
    let offset = params.offset.unwrap_or(0);
    let count = params.count.unwrap_or(size.max(30)).min(200);
    let exclude_recent_days = params.exclude_recent_days.unwrap_or(7);
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    #[cfg(feature = "bliss")]
    {
        let result = discover_similar_songs(
            &state.database,
            user.user_id,
            count,
            exclude_recent_days,
            size,
            offset,
            inline_size,
            params.seed,
            params.seed_song_id.clone(),
        )
        .await?;

        Ok(([(header::CACHE_CONTROL, "private, no-store")], Json(result)))
    }

    #[cfg(not(feature = "bliss"))]
    {
        _ = (&user, &state, &params);
        Ok((
            [(header::CACHE_CONTROL, "private, no-store")],
            Json(DiscoveryResponse {
                song: Vec::new(),
                total: 0,
                seed: params.seed.unwrap_or(0),
                count,
                exclude_recent_days,
                seed_song_id: params.seed_song_id.clone(),
            }),
        ))
    }
}

/// Core discovery logic: find songs similar to the user's recent listening.
#[cfg(feature = "bliss")]
#[allow(clippy::too_many_arguments)]
pub async fn discover_similar_songs(
    database: &crate::db::Database,
    user_id: i64,
    count: i64,
    exclude_recent_days: i64,
    size: i64,
    offset: i64,
    inline_image_size: Option<ThumbnailSize>,
    seed: Option<i64>,
    seed_song_id: Option<String>,
) -> crate::error::Result<DiscoveryResponse> {
    use chrono::Duration;

    // 1. Pick a seed song. Prefer the explicitly-provided seed_song_id; fall
    // back to the most-recently-played song. Tracking the resolved seed song
    // ID lets callers re-materialize the same list later (e.g. for playback
    // queues) even if the user's scrobble history has since changed — which
    // matters for remote-controlling sessions where another tab is advancing
    // playback and recording scrobbles.
    let seed_id = match seed_song_id {
        Some(id) => id,
        None => {
            let seed_aggregates = crate::db::repo::history::list_recent_song_aggregates(
                database.conn(),
                user_id,
                1,
                0,
            )
            .await?;
            match seed_aggregates.first() {
                Some(row) => row.song_id.clone(),
                None => {
                    return Ok(DiscoveryResponse {
                        song: Vec::new(),
                        total: 0,
                        seed: seed.unwrap_or_else(rand::random::<i64>),
                        count,
                        exclude_recent_days,
                        seed_song_id: None,
                    });
                }
            }
        }
    };

    let response_seed = seed.unwrap_or_else(rand::random::<i64>);
    let rng_seed = Some(response_seed as u64);

    // 2. Get "recently played" set to exclude (avoid recommending what they just heard)
    let cutoff = chrono::Utc::now() - Duration::days(exclude_recent_days);
    let recent_excluded: std::collections::HashSet<String> =
        crate::db::repo::history::list_recent_song_aggregates(
            database.conn(),
            user_id,
            500, // fetch enough to cover the exclusion window
            0,
        )
        .await?
        .into_iter()
        .filter(|agg| agg.last_played.is_some_and(|t| t >= cutoff))
        .map(|agg| agg.song_id)
        .collect();

    // 3. Find similar songs using bliss (loads all candidates, computes distances)
    let similar =
        crate::bliss::find_similar_songs(database, &seed_id, user_id, count as usize, rng_seed)
            .await?;

    // 4. Filter out recently played songs
    let filtered: Vec<(String, f32)> = similar
        .into_iter()
        .filter(|(song_id, _)| !recent_excluded.contains(song_id))
        .collect();

    let total = filtered.len() as i64;

    if filtered.is_empty() {
        return Ok(DiscoveryResponse {
            song: Vec::new(),
            total: 0,
            seed: response_seed,
            count,
            exclude_recent_days,
            seed_song_id: Some(seed_id),
        });
    }

    // 5. Paginate
    let paginated_ids: Vec<String> = filtered
        .into_iter()
        .skip(offset as usize)
        .take(size as usize)
        .map(|(id, _)| id)
        .collect();

    if paginated_ids.is_empty() {
        return Ok(DiscoveryResponse {
            song: Vec::new(),
            total,
            seed: response_seed,
            count,
            exclude_recent_days,
            seed_song_id: Some(seed_id),
        });
    }

    // 6. Fetch song details
    let songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, &paginated_ids, user_id)
            .await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let thumbnails = if let Some(thumb_size) = inline_image_size {
        let song_album_pairs: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|song| (song.id.clone(), song.album_id.clone()))
            .collect();
        crate::api::inline_thumbnails::get_song_thumbnails_base64(
            database,
            &song_album_pairs,
            thumb_size,
        )
        .await
    } else {
        std::collections::HashMap::new()
    };

    let responses: Vec<crate::api::common::models::SongResponse> = songs
        .into_iter()
        .map(|song| {
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song
                    .last_played
                    .map(crate::api::common::utils::format_datetime_iso_ms),
            };
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            let cover_art_data = thumbnails.get(&song.id).cloned();
            song_to_response_with_stats(
                song,
                None,
                starred,
                user_rating,
                Some(play_stats),
                None,
                cover_art_data,
            )
        })
        .collect();

    Ok(DiscoveryResponse {
        song: responses,
        total,
        seed: response_seed,
        count,
        exclude_recent_days,
        seed_song_id: Some(seed_id),
    })
}
