//! Batch home page endpoint for the Ferrotune API.
//!
//! Returns all home page sections in a single request for reduced latency.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::lists::{
    get_album_list_logic, get_continue_listening_logic, get_forgotten_favorites_logic,
    get_most_played_recently_logic, AlbumListType, ContinueListeningEntry, ListViewOptions,
};
use crate::api::common::models::SongResponse;
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
    /// Include Continue Listening in the batch response (default true)
    pub include_continue_listening: Option<bool>,
    /// Include Most Played Recently in the batch response (default true)
    pub include_most_played_recently: Option<bool>,
    /// Include Recently Added in the batch response (default true)
    pub include_recently_added: Option<bool>,
    /// Include Forgotten Favorites in the batch response (default true)
    pub include_forgotten_favorites: Option<bool>,
    /// Include Discover in the batch response (default true)
    pub include_discover: Option<bool>,
    /// Include Similar Tracks (discovery) in the batch response (default true)
    pub include_similar_tracks: Option<bool>,
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

/// A section of the home page containing songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct HomeSongSection {
    pub song: Vec<SongResponse>,
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
    pub most_played_recently: HomeSongSection,
    pub recently_added: HomeAlbumSection,
    pub forgotten_favorites: HomeForgottenFavoritesSection,
    pub discover: HomeAlbumSection,
    pub similar_tracks: HomeSongSection,
}

/// GET /api/home - Get all home page data in a single request
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

    let database = &state.database;
    let user_id = user.user_id;

    // Compute "since 30 days ago" for recently frequent tracks
    let since = chrono::Utc::now() - chrono::Duration::days(30);
    let since_str = since.format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let include_continue_listening = params.include_continue_listening.unwrap_or(true);
    let include_most_played_recently = params.include_most_played_recently.unwrap_or(true);
    let include_recently_added = params.include_recently_added.unwrap_or(true);
    let include_forgotten_favorites = params.include_forgotten_favorites.unwrap_or(true);
    let include_discover = params.include_discover.unwrap_or(true);
    let include_similar_tracks = params.include_similar_tracks.unwrap_or(true);

    // Run requested queries concurrently. Skipped sections return empty payloads
    // so older clients keep the same response shape while newer clients avoid
    // paying for disabled or separately configured sections.
    let (
        continue_result,
        frequent_result,
        newest_result,
        random_result,
        forgotten_result,
        similar_result,
    ) = tokio::join!(
        async {
            if !include_continue_listening {
                return Ok::<HomeContinueListeningSection, crate::error::FerrotuneApiError>(
                    HomeContinueListeningSection {
                        entries: Vec::new(),
                        total: 0,
                    },
                );
            }

            let continue_listening = get_continue_listening_logic(
                &state.database,
                user_id,
                size,
                0,
                inline_size,
                ListViewOptions::default(),
            )
            .await?;
            Ok::<HomeContinueListeningSection, crate::error::FerrotuneApiError>(
                HomeContinueListeningSection {
                    entries: continue_listening.entries,
                    total: continue_listening.total,
                },
            )
        },
        async {
            if !include_most_played_recently {
                return Ok::<HomeSongSection, crate::error::FerrotuneApiError>(HomeSongSection {
                    song: Vec::new(),
                    total: 0,
                });
            }

            let frequent = get_most_played_recently_logic(
                database,
                user_id,
                size,
                0,
                inline_size,
                Some(since_str),
                ListViewOptions::default(),
            )
            .await?;
            Ok::<HomeSongSection, crate::error::FerrotuneApiError>(HomeSongSection {
                song: frequent.songs,
                total: frequent.total,
            })
        },
        async {
            if !include_recently_added {
                return Ok::<HomeAlbumSection, crate::error::FerrotuneApiError>(HomeAlbumSection {
                    album: Vec::new(),
                    total: Some(0),
                    seed: None,
                });
            }

            let newest = get_album_list_logic(
                database,
                user_id,
                AlbumListType::Newest,
                size,
                0,
                None,
                None,
                None,
                inline_size,
                None,
                None,
                None,
                None,
                None,
            )
            .await?;
            Ok::<HomeAlbumSection, crate::error::FerrotuneApiError>(HomeAlbumSection {
                album: newest.albums,
                total: newest.total,
                seed: None,
            })
        },
        async {
            if !include_discover {
                return Ok::<HomeAlbumSection, crate::error::FerrotuneApiError>(HomeAlbumSection {
                    album: Vec::new(),
                    total: Some(0),
                    seed: params.discover_seed,
                });
            }

            let random = get_album_list_logic(
                database,
                user_id,
                AlbumListType::Random,
                size,
                0,
                None,
                None,
                None,
                inline_size,
                None,
                params.discover_seed,
                None,
                None,
                None,
            )
            .await?;
            Ok::<HomeAlbumSection, crate::error::FerrotuneApiError>(HomeAlbumSection {
                album: random.albums,
                total: random.total,
                seed: random.seed,
            })
        },
        async {
            if !include_forgotten_favorites {
                return Ok::<HomeForgottenFavoritesSection, crate::error::FerrotuneApiError>(
                    HomeForgottenFavoritesSection {
                        song: Vec::new(),
                        total: 0,
                        seed: params.forgotten_fav_seed.unwrap_or(0),
                    },
                );
            }

            let forgotten = get_forgotten_favorites_logic(
                database,
                user_id,
                size,
                0,
                10,
                90,
                inline_size,
                params.forgotten_fav_seed,
                ListViewOptions::default(),
            )
            .await?;
            Ok::<HomeForgottenFavoritesSection, crate::error::FerrotuneApiError>(
                HomeForgottenFavoritesSection {
                    song: forgotten.songs,
                    total: forgotten.total,
                    seed: forgotten.seed,
                },
            )
        },
        async {
            if !include_similar_tracks {
                return Ok::<HomeSongSection, crate::error::FerrotuneApiError>(HomeSongSection {
                    song: Vec::new(),
                    total: 0,
                });
            }

            #[cfg(feature = "bliss")]
            {
                let similar = crate::api::discovery::discover_similar_songs(
                    database,
                    user_id,
                    size,
                    7,
                    size,
                    0,
                    inline_size,
                    None,
                    None,
                )
                .await?;
                Ok::<HomeSongSection, crate::error::FerrotuneApiError>(HomeSongSection {
                    song: similar.song,
                    total: similar.total,
                })
            }

            #[cfg(not(feature = "bliss"))]
            {
                Ok::<HomeSongSection, crate::error::FerrotuneApiError>(HomeSongSection {
                    song: Vec::new(),
                    total: 0,
                })
            }
        },
    );

    Ok((
        [
            (header::CACHE_CONTROL, "private, no-store"),
            (header::VARY, "Authorization"),
        ],
        Json(HomePageResponse {
            continue_listening: continue_result?,
            most_played_recently: frequent_result?,
            recently_added: newest_result?,
            forgotten_favorites: forgotten_result?,
            discover: random_result?,
            similar_tracks: similar_result?,
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
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub sort_dir: Option<String>,
}

/// GET /api/continue-listening - Paginated continue listening entries
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

    let result = get_continue_listening_logic(
        &state.database,
        user.user_id,
        size,
        offset,
        inline_size,
        ListViewOptions {
            filter: params.filter.as_deref(),
            sort: params.sort.as_deref(),
            sort_dir: params.sort_dir.as_deref(),
        },
    )
    .await?;

    Ok(Json(HomeContinueListeningSection {
        entries: result.entries,
        total: result.total,
    }))
}
