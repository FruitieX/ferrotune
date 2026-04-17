//! Batch home page endpoint for the Ferrotune API.
//!
//! Returns all home page sections in a single request for reduced latency.

use crate::api::common::lists::{
    get_album_list_logic, get_continue_listening_logic, get_forgotten_favorites_logic,
    AlbumListType, ContinueListeningEntry,
};
use crate::api::common::models::SongResponse;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::FerrotuneApiResult;
use crate::thumbnails::ThumbnailSize;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Query params for the home page endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomePageParams {
    /// Page size for each section (default 15)
    pub size: Option<i64>,
    /// Include inline cover art thumbnails (small or medium)
    pub inline_images: Option<String>,
    /// Random seed for Discover section
    pub discover_seed: Option<i64>,
    /// Random seed for Forgotten Favorites section
    pub forgotten_fav_seed: Option<i64>,
}

/// A section of the home page containing albums
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct HomeAlbumSection {
    pub album: Vec<crate::api::common::models::AlbumResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub total: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub seed: Option<i64>,
}

/// The continue listening section with mixed source types
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct HomeContinueListeningSection {
    pub entries: Vec<ContinueListeningEntry>,
    #[ts(type = "number")]
    pub total: i64,
}

/// The forgotten favorites section of the home page
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct HomeForgottenFavoritesSection {
    pub song: Vec<SongResponse>,
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub seed: i64,
}

/// Combined home page response
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct HomePageResponse {
    pub continue_listening: HomeContinueListeningSection,
    pub most_played_recently: HomeAlbumSection,
    pub recently_added: HomeAlbumSection,
    pub forgotten_favorites: HomeForgottenFavoritesSection,
    pub discover: HomeAlbumSection,
}

/// GET /ferrotune/home - Get all home page data in a single request
pub async fn get_home(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<HomePageParams>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let size = params.size.unwrap_or(15).min(100);
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    let pool = &state.pool;
    let user_id = user.user_id;

    // Compute "since 30 days ago" for frequent albums
    let since = chrono::Utc::now() - chrono::Duration::days(30);
    let since_str = since.format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // Run all queries concurrently
    let (continue_result, frequent_result, newest_result, random_result, forgotten_result) = tokio::join!(
        get_continue_listening_logic(pool, user_id, size, 0, inline_size),
        get_album_list_logic(
            pool,
            user_id,
            AlbumListType::Frequent,
            size,
            0,
            None,
            None,
            None,
            inline_size,
            Some(since_str),
            None
        ),
        get_album_list_logic(
            pool,
            user_id,
            AlbumListType::Newest,
            size,
            0,
            None,
            None,
            None,
            inline_size,
            None,
            None
        ),
        get_album_list_logic(
            pool,
            user_id,
            AlbumListType::Random,
            size,
            0,
            None,
            None,
            None,
            inline_size,
            None,
            params.discover_seed
        ),
        get_forgotten_favorites_logic(
            pool,
            user_id,
            size,
            0,
            10,
            90,
            inline_size,
            params.forgotten_fav_seed
        ),
    );

    let continue_listening = continue_result?;
    let frequent = frequent_result?;
    let newest = newest_result?;
    let random = random_result?;
    let forgotten = forgotten_result?;

    Ok((
        [
            (header::CACHE_CONTROL, "private, no-store"),
            (header::VARY, "Authorization"),
        ],
        Json(HomePageResponse {
            continue_listening: HomeContinueListeningSection {
                entries: continue_listening.entries,
                total: continue_listening.total,
            },
            most_played_recently: HomeAlbumSection {
                album: frequent.albums,
                total: frequent.total,
                seed: None,
            },
            recently_added: HomeAlbumSection {
                album: newest.albums,
                total: newest.total,
                seed: None,
            },
            forgotten_favorites: HomeForgottenFavoritesSection {
                song: forgotten.songs,
                total: forgotten.total,
                seed: forgotten.seed,
            },
            discover: HomeAlbumSection {
                album: random.albums,
                total: random.total,
                seed: random.seed,
            },
        }),
    ))
}

/// Query params for the continue listening endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueListeningParams {
    pub size: Option<i64>,
    pub offset: Option<i64>,
    pub inline_images: Option<String>,
}

/// GET /ferrotune/continue-listening - Paginated continue listening entries
pub async fn get_continue_listening(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ContinueListeningParams>,
) -> FerrotuneApiResult<Json<HomeContinueListeningSection>> {
    let size = params.size.unwrap_or(15).min(100);
    let offset = params.offset.unwrap_or(0);
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    let result =
        get_continue_listening_logic(&state.pool, user.user_id, size, offset, inline_size).await?;

    Ok(Json(HomeContinueListeningSection {
        entries: result.entries,
        total: result.total,
    }))
}
