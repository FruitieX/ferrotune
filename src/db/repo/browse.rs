//! Browse queries: artists, albums, songs.
//!
//! SeaORM replacement for the browse-related bodies in `src/db/queries.rs`.
//! This module now uses SeaORM query-builder and Entity patterns for the
//! browse read surface, including the song list/read queries. Aggregated play
//! stats are composed via the shared scrobble repo helpers instead of inline
//! dialect-specific SQL.

use sea_orm::sea_query::{Expr, ExprTrait, Func, SimpleExpr};
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, JoinType, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, RelationTrait, Value,
};

use std::collections::HashMap;

use crate::db::entity;
use crate::db::models::{Album, Artist, Song, SongWithFolder, SongWithLibraryStatus};
use crate::db::ordering::case_insensitive_order;
use crate::db::repo::scrobbles::{self, PlayStatsAggregation, SongPlayStatsRow};
use crate::db::repo::users;
use crate::db::Database;
use crate::error::Result;

fn artist_sort_expr(database: &Database) -> SimpleExpr {
    let sort_expr = Expr::col(entity::artists::Column::SortName)
        .if_null(Expr::col(entity::artists::Column::Name));

    match database.sea_backend() {
        sea_orm::DbBackend::Sqlite => Expr::cust_with_expr("$1 COLLATE NOCASE", sort_expr),
        sea_orm::DbBackend::Postgres | sea_orm::DbBackend::MySql => {
            SimpleExpr::FunctionCall(Func::lower(sort_expr))
        }
    }
}

async fn enabled_music_folder_ids(database: &Database) -> Result<Vec<i64>> {
    entity::music_folders::Entity::find()
        .select_only()
        .column(entity::music_folders::Column::Id)
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .into_tuple::<i64>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

async fn visible_artist_ids(database: &Database, folder_ids: &[i64]) -> Result<Vec<String>> {
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::ArtistId)
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .distinct()
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

async fn visible_album_ids_for_artist(
    database: &Database,
    artist_id: &str,
    folder_ids: &[i64],
) -> Result<Vec<String>> {
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    let album_ids = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::AlbumId)
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .filter(
            entity::songs::Column::ArtistId.eq(artist_id).or(Expr::col((
                entity::songs::Entity,
                entity::songs::Column::AlbumId,
            ))
            .in_subquery(
                entity::albums::Entity::find()
                    .select_only()
                    .column(entity::albums::Column::Id)
                    .filter(entity::albums::Column::ArtistId.eq(artist_id))
                    .into_query(),
            )),
        )
        .distinct()
        .into_tuple::<Option<String>>()
        .all(database.conn())
        .await?;

    Ok(album_ids.into_iter().flatten().collect())
}

fn artist_select() -> sea_orm::Select<entity::artists::Entity> {
    entity::artists::Entity::find().select_only().columns([
        entity::artists::Column::Id,
        entity::artists::Column::Name,
        entity::artists::Column::SortName,
        entity::artists::Column::AlbumCount,
        entity::artists::Column::SongCount,
        entity::artists::Column::CoverArtHash,
    ])
}

fn album_select() -> sea_orm::Select<entity::albums::Entity> {
    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .column(entity::albums::Column::Name)
        .column(entity::albums::Column::ArtistId)
        .column(entity::albums::Column::Year)
        .column(entity::albums::Column::Genre)
        .column(entity::albums::Column::SongCount)
        .column(entity::albums::Column::Duration)
        .column(entity::albums::Column::CreatedAt)
        .column(entity::albums::Column::CoverArtHash)
        .column_as(entity::artists::Column::Name, "artist_name")
        .join(JoinType::InnerJoin, entity::albums::Relation::Artists.def())
}

fn order_artist_albums(
    query: sea_orm::Select<entity::albums::Entity>,
    backend: sea_orm::DbBackend,
) -> sea_orm::Select<entity::albums::Entity> {
    query
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Year)),
            Order::Desc,
        )
        .order_by(
            case_insensitive_order(
                backend,
                (entity::albums::Entity, entity::albums::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Id)),
            Order::Asc,
        )
}

fn nullable_bigint_expr(database: &Database) -> SimpleExpr {
    match database.sea_backend() {
        sea_orm::DbBackend::Sqlite => Expr::value(Value::BigInt(None)),
        sea_orm::DbBackend::Postgres | sea_orm::DbBackend::MySql => {
            Expr::value(Value::BigInt(None)).cast_as("BIGINT")
        }
    }
}

fn nullable_timestamptz_expr(database: &Database) -> SimpleExpr {
    match database.sea_backend() {
        sea_orm::DbBackend::Sqlite => Expr::value(Value::ChronoDateTimeWithTimeZone(None)),
        sea_orm::DbBackend::Postgres | sea_orm::DbBackend::MySql => {
            Expr::value(Value::ChronoDateTimeWithTimeZone(None)).cast_as("TIMESTAMPTZ")
        }
    }
}

pub(crate) fn song_select(database: &Database) -> sea_orm::Select<entity::songs::Entity> {
    entity::songs::Entity::find()
        .join(JoinType::InnerJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .column_as(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name)),
            "artist_name",
        )
        .column_as(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name)),
            "album_name",
        )
        .column_as(nullable_bigint_expr(database), "play_count")
        .column_as(nullable_timestamptz_expr(database), "last_played")
        .column_as(nullable_timestamptz_expr(database), "starred_at")
        .column_as(nullable_bigint_expr(database), "play_starts")
}

fn song_with_folder_select(database: &Database) -> sea_orm::Select<entity::songs::Entity> {
    song_select(database)
        .join(
            JoinType::LeftJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .column_as(
            Expr::col((
                entity::music_folders::Entity,
                entity::music_folders::Column::Path,
            )),
            "folder_path",
        )
}

fn song_with_library_status_select(database: &Database) -> sea_orm::Select<entity::songs::Entity> {
    song_select(database)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .column_as(
            Expr::col((
                entity::music_folders::Entity,
                entity::music_folders::Column::Enabled,
            )),
            "library_enabled",
        )
}

pub(crate) fn apply_song_play_stats(
    songs: &mut [Song],
    stats: Vec<SongPlayStatsRow>,
    play_starts: Vec<(String, i64)>,
) {
    let stats_by_song = stats
        .into_iter()
        .map(|row| {
            let song_id = row.song_id.clone();
            (song_id, row)
        })
        .collect::<HashMap<_, _>>();

    let play_starts_by_song = play_starts.into_iter().collect::<HashMap<String, i64>>();

    for song in songs {
        if let Some(row) = stats_by_song.get(&song.id) {
            song.play_count = Some(row.play_count);
            song.last_played = row.last_played;
        } else {
            song.play_count = None;
            song.last_played = None;
        }
        song.play_starts = play_starts_by_song.get(&song.id).copied();
        song.starred_at = None;
    }
}

fn apply_song_library_status_play_stats(
    songs: &mut [SongWithLibraryStatus],
    stats: Vec<SongPlayStatsRow>,
    play_starts: Vec<(String, i64)>,
) {
    let stats_by_song = stats
        .into_iter()
        .map(|row| {
            let song_id = row.song_id.clone();
            (song_id, row)
        })
        .collect::<HashMap<_, _>>();

    let play_starts_by_song = play_starts.into_iter().collect::<HashMap<String, i64>>();

    for song in songs {
        if let Some(row) = stats_by_song.get(&song.id) {
            song.play_count = Some(row.play_count);
            song.last_played = row.last_played;
        } else {
            song.play_count = None;
            song.last_played = None;
        }
        song.play_starts = play_starts_by_song.get(&song.id).copied();
        song.starred_at = None;
    }
}

fn artist_song_condition(artist_id: &str, album_ids: &[String]) -> Condition {
    let mut condition = Condition::any().add(entity::songs::Column::ArtistId.eq(artist_id));

    if !album_ids.is_empty() {
        condition = condition.add(entity::songs::Column::AlbumId.is_in(album_ids.iter().cloned()));
    }

    condition
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

pub async fn get_artists(database: &Database) -> Result<Vec<Artist>> {
    let folder_ids = enabled_music_folder_ids(database).await?;
    let artist_ids = visible_artist_ids(database, &folder_ids).await?;

    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }

    artist_select()
        .filter(entity::artists::Column::Id.is_in(artist_ids))
        .order_by(artist_sort_expr(database), Order::Asc)
        .order_by_asc(entity::artists::Column::Name)
        .into_model::<Artist>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn get_artists_for_user(database: &Database, user_id: i64) -> Result<Vec<Artist>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    let artist_ids = visible_artist_ids(database, &folder_ids).await?;

    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }

    artist_select()
        .filter(entity::artists::Column::Id.is_in(artist_ids))
        .order_by(artist_sort_expr(database), Order::Asc)
        .order_by_asc(entity::artists::Column::Name)
        .into_model::<Artist>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn get_artist_by_id(database: &Database, id: &str) -> Result<Option<Artist>> {
    artist_select()
        .filter(entity::artists::Column::Id.eq(id))
        .into_model::<Artist>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

pub async fn get_albums_by_artist(database: &Database, artist_id: &str) -> Result<Vec<Album>> {
    let folder_ids = enabled_music_folder_ids(database).await?;
    let album_ids = visible_album_ids_for_artist(database, artist_id, &folder_ids).await?;

    if album_ids.is_empty() {
        return Ok(Vec::new());
    }

    album_select()
        .filter(entity::albums::Column::ArtistId.eq(artist_id))
        .filter(entity::albums::Column::Id.is_in(album_ids))
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Year)),
            Order::Asc,
        )
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::albums::Entity, entity::albums::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name)),
            Order::Asc,
        )
        .into_model::<Album>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn get_albums_by_artist_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
) -> Result<Vec<Album>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    let album_ids = visible_album_ids_for_artist(database, artist_id, &folder_ids).await?;

    if album_ids.is_empty() {
        return Ok(Vec::new());
    }

    album_select()
        .filter(entity::albums::Column::ArtistId.eq(artist_id))
        .filter(entity::albums::Column::Id.is_in(album_ids))
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Year)),
            Order::Asc,
        )
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::albums::Entity, entity::albums::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name)),
            Order::Asc,
        )
        .into_model::<Album>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn get_album_by_id(database: &Database, id: &str) -> Result<Option<Album>> {
    album_select()
        .filter(entity::albums::Column::Id.eq(id))
        .into_model::<Album>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

pub async fn get_songs_by_album(database: &Database, album_id: &str) -> Result<Vec<Song>> {
    let mut songs = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::AlbumId.eq(album_id))
        .order_by_asc(entity::songs::Column::DiscNumber)
        .order_by_asc(entity::songs::Column::TrackNumber)
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::songs::Column::Title),
            Order::Asc,
        )
        .order_by_asc(entity::songs::Column::Title)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        None,
        &song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, None, &song_ids).await?;
    apply_song_play_stats(&mut songs, stats, play_starts);

    Ok(songs)
}

pub async fn get_songs_by_album_for_user(
    database: &Database,
    album_id: &str,
    user_id: i64,
) -> Result<Vec<Song>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut songs = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::AlbumId.eq(album_id))
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .order_by_asc(entity::songs::Column::DiscNumber)
        .order_by_asc(entity::songs::Column::TrackNumber)
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::songs::Column::Title),
            Order::Asc,
        )
        .order_by_asc(entity::songs::Column::Title)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        None,
        &song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, None, &song_ids).await?;
    apply_song_play_stats(&mut songs, stats, play_starts);

    Ok(songs)
}

/// Get all songs by a specific artist (both track artist and album artist).
pub async fn get_songs_by_artist(database: &Database, artist_id: &str) -> Result<Vec<Song>> {
    let folder_ids = enabled_music_folder_ids(database).await?;
    let album_ids = visible_album_ids_for_artist(database, artist_id, &folder_ids).await?;

    let mut songs = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(artist_song_condition(artist_id, &album_ids))
        .order_by_asc(entity::songs::Column::AlbumId)
        .order_by_asc(entity::songs::Column::DiscNumber)
        .order_by_asc(entity::songs::Column::TrackNumber)
        .order_by_asc(entity::songs::Column::Title)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        None,
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, None, &song_ids).await?;
    apply_song_play_stats(&mut songs, stats, play_starts);

    Ok(songs)
}

pub async fn get_songs_by_artist_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
) -> Result<Vec<Song>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    let album_ids = visible_album_ids_for_artist(database, artist_id, &folder_ids).await?;
    let mut songs = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .filter(artist_song_condition(artist_id, &album_ids))
        .order_by_asc(entity::songs::Column::AlbumId)
        .order_by_asc(entity::songs::Column::DiscNumber)
        .order_by_asc(entity::songs::Column::TrackNumber)
        .order_by_asc(entity::songs::Column::Title)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, Some(user_id), &song_ids)
            .await?;
    apply_song_play_stats(&mut songs, stats, play_starts);

    Ok(songs)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollectionSongSort {
    Natural,
    TrackNumber,
    Name,
    Artist,
    Album,
    Year,
    Genre,
    DateAdded,
    Duration,
    BitRate,
    Format,
    PlayCount,
    PlayStarts,
    LastPlayed,
}

#[derive(Debug)]
pub struct CollectionSongPage {
    pub songs: Vec<Song>,
    pub total: i64,
}

fn collection_song_filter(filter: Option<&str>) -> Option<Condition> {
    filter
        .filter(|value| !value.trim().is_empty())
        .map(|filter| {
            let pattern = format!("%{}%", filter.to_lowercase());
            Condition::any()
                .add(
                    Expr::expr(Func::lower(Expr::col((
                        entity::songs::Entity,
                        entity::songs::Column::Title,
                    ))))
                    .like(pattern.clone()),
                )
                .add(
                    Expr::expr(Func::lower(Expr::col((
                        entity::artists::Entity,
                        entity::artists::Column::Name,
                    ))))
                    .like(pattern.clone()),
                )
                .add(
                    Expr::expr(Func::lower(Expr::col((
                        entity::albums::Entity,
                        entity::albums::Column::Name,
                    ))))
                    .like(pattern.clone()),
                )
                .add(Expr::expr(Func::lower(Expr::col(entity::songs::Column::Genre))).like(pattern))
        })
}

fn order_collection_songs(
    database: &Database,
    mut query: sea_orm::Select<entity::songs::Entity>,
    user_id: i64,
    sort: CollectionSongSort,
    descending: bool,
) -> sea_orm::Select<entity::songs::Entity> {
    use entity::songs::Column as SongColumn;

    let order = if descending { Order::Desc } else { Order::Asc };
    query = match sort {
        CollectionSongSort::Natural | CollectionSongSort::TrackNumber => query
            .order_by(SongColumn::DiscNumber, order.clone())
            .order_by(SongColumn::TrackNumber, order.clone()),
        CollectionSongSort::Name => query.order_by(
            case_insensitive_order(database.sea_backend(), SongColumn::Title),
            order.clone(),
        ),
        CollectionSongSort::Artist => query.order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::artists::Entity, entity::artists::Column::Name),
            ),
            order.clone(),
        ),
        CollectionSongSort::Album => query.order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::albums::Entity, entity::albums::Column::Name),
            ),
            order.clone(),
        ),
        CollectionSongSort::Year => query.order_by(
            Expr::col((entity::songs::Entity, SongColumn::Year)).if_null(0),
            order.clone(),
        ),
        CollectionSongSort::Genre => query.order_by(
            case_insensitive_order(database.sea_backend(), SongColumn::Genre),
            order.clone(),
        ),
        CollectionSongSort::DateAdded => query.order_by(SongColumn::CreatedAt, order.clone()),
        CollectionSongSort::Duration => query.order_by(SongColumn::Duration, order.clone()),
        CollectionSongSort::BitRate => query.order_by(SongColumn::Bitrate, order.clone()),
        CollectionSongSort::Format => query.order_by(
            case_insensitive_order(database.sea_backend(), SongColumn::FileFormat),
            order.clone(),
        ),
        CollectionSongSort::PlayCount => query.order_by(
            Expr::cust(format!(
                "(SELECT COALESCE(SUM(sc.play_count), 0) FROM scrobbles sc \
                 WHERE sc.song_id = songs.id AND sc.user_id = {user_id} \
                 AND sc.submission = TRUE)"
            )),
            order.clone(),
        ),
        CollectionSongSort::PlayStarts => query.order_by(
            Expr::cust(format!(
                "(SELECT COUNT(*) FROM playback_starts ps \
                 WHERE ps.song_id = songs.id AND ps.user_id = {user_id} \
                 AND ps.explicit_start = TRUE)"
            )),
            order.clone(),
        ),
        CollectionSongSort::LastPlayed => {
            let last_played = format!(
                "(SELECT MAX(sc.played_at) FROM scrobbles sc \
                 WHERE sc.song_id = songs.id AND sc.user_id = {user_id} \
                 AND sc.submission = TRUE)"
            );
            query
                .order_by(Expr::cust(format!("{last_played} IS NULL")), Order::Asc)
                .order_by(Expr::cust(last_played), order.clone())
        }
    };
    query
        .order_by(
            case_insensitive_order(database.sea_backend(), SongColumn::Title),
            order,
        )
        .order_by_asc(SongColumn::Id)
}

#[allow(clippy::too_many_arguments)]
async fn page_collection_songs(
    database: &Database,
    user_id: i64,
    collection_condition: Condition,
    filter: Option<&str>,
    sort: CollectionSongSort,
    descending: bool,
    offset: u64,
    limit: u64,
) -> Result<CollectionSongPage> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(CollectionSongPage {
            songs: Vec::new(),
            total: 0,
        });
    }

    let mut query = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids))
        .filter(collection_condition);
    if let Some(filter_condition) = collection_song_filter(filter) {
        query = query.filter(filter_condition);
    }
    let total = query.clone().count(database.conn()).await? as i64;
    let mut songs = order_collection_songs(database, query, user_id, sort, descending)
        .offset(offset)
        .limit(limit)
        .into_model::<Song>()
        .all(database.conn())
        .await?;
    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, Some(user_id), &song_ids)
            .await?;
    apply_song_play_stats(&mut songs, stats, play_starts);
    Ok(CollectionSongPage { songs, total })
}

#[allow(clippy::too_many_arguments)]
pub async fn page_album_songs_for_user(
    database: &Database,
    album_id: &str,
    user_id: i64,
    filter: Option<&str>,
    sort: CollectionSongSort,
    descending: bool,
    offset: u64,
    limit: u64,
) -> Result<CollectionSongPage> {
    page_collection_songs(
        database,
        user_id,
        Condition::all().add(entity::songs::Column::AlbumId.eq(album_id)),
        filter,
        sort,
        descending,
        offset,
        limit,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn page_artist_songs_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
    filter: Option<&str>,
    sort: CollectionSongSort,
    descending: bool,
    offset: u64,
    limit: u64,
) -> Result<CollectionSongPage> {
    page_collection_songs(
        database,
        user_id,
        Condition::any()
            .add(entity::songs::Column::ArtistId.eq(artist_id))
            .add(entity::albums::Column::ArtistId.eq(artist_id)),
        filter,
        sort,
        descending,
        offset,
        limit,
    )
    .await
}

#[derive(Debug)]
pub struct ArtistAlbumPage {
    pub albums: Vec<Album>,
    pub total: i64,
}

pub async fn page_albums_by_artist_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
    offset: u64,
    limit: u64,
) -> Result<ArtistAlbumPage> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    let album_ids = visible_album_ids_for_artist(database, artist_id, &folder_ids).await?;
    if album_ids.is_empty() {
        return Ok(ArtistAlbumPage {
            albums: Vec::new(),
            total: 0,
        });
    }
    let query = album_select()
        .filter(entity::albums::Column::ArtistId.eq(artist_id))
        .filter(entity::albums::Column::Id.is_in(album_ids));
    let total = query.clone().count(database.conn()).await? as i64;
    let albums = order_artist_albums(query, database.sea_backend())
        .offset(offset)
        .limit(limit)
        .into_model::<Album>()
        .all(database.conn())
        .await?;
    Ok(ArtistAlbumPage { albums, total })
}

pub async fn get_song_by_id(database: &Database, id: &str) -> Result<Option<Song>> {
    song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::Id.eq(id))
        .into_model::<Song>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn get_songs_by_ids_for_user(
    database: &Database,
    ids: &[String],
    user_id: i64,
) -> Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    let songs = song_select(database)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::Id.is_in(ids.iter().cloned()))
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    // Preserve the input ordering.
    let song_map: std::collections::HashMap<String, Song> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();
    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get songs by a list of IDs with their library enabled status.
/// Returns songs from ALL music folders (including disabled ones).
pub async fn get_songs_by_ids_with_library_status(
    database: &Database,
    ids: &[String],
    user_id: i64,
) -> Result<Vec<SongWithLibraryStatus>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut songs = song_with_library_status_select(database)
        .filter(entity::songs::Column::Id.is_in(ids.iter().cloned()))
        .into_model::<SongWithLibraryStatus>()
        .all(database.conn())
        .await?;

    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let stats = scrobbles::fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?;
    let play_starts =
        crate::db::repo::listening::fetch_song_play_starts_rows(database, Some(user_id), &song_ids)
            .await?;
    apply_song_library_status_play_stats(&mut songs, stats, play_starts);

    // Preserve the input ordering.
    let song_map: std::collections::HashMap<String, SongWithLibraryStatus> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();
    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get a song by ID with its music folder path for full filesystem path construction.
pub async fn get_song_by_id_with_folder(
    database: &Database,
    id: &str,
) -> Result<Option<SongWithFolder>> {
    song_with_folder_select(database)
        .filter(entity::songs::Column::Id.eq(id))
        .into_model::<SongWithFolder>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Genres / indexes / listings (migrated from common/browse.rs raw SQL)
// ---------------------------------------------------------------------------

/// Row shape returned by [`list_genres_for_user`].
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct GenreRow {
    pub genre: String,
    pub song_count: i64,
    pub album_count: i64,
}

/// List distinct genres visible to `user_id` along with song and album counts,
/// ordered case-insensitively by genre name.
pub async fn list_genres_for_user(database: &Database, user_id: i64) -> Result<Vec<GenreRow>> {
    let backend = database.sea_backend();

    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Genre)
        .expr_as(
            Expr::expr(Expr::col((
                entity::songs::Entity,
                entity::songs::Column::Id,
            )))
            .count_distinct(),
            "song_count",
        )
        .expr_as(
            Expr::expr(Expr::col((
                entity::songs::Entity,
                entity::songs::Column::AlbumId,
            )))
            .count_distinct(),
            "album_count",
        )
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(entity::songs::Column::Genre.is_not_null())
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .group_by(entity::songs::Column::Genre)
        .order_by(
            case_insensitive_order(backend, entity::songs::Column::Genre),
            Order::Asc,
        )
        .into_model::<GenreRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// Return all `file_path` values visible to `user_id` from enabled music
/// folders, optionally scoped to a single folder id. Callers split the path
/// client-side to build directory indexes — this avoids a dialect-specific
/// SQL `substr`/`split_part` branch.
pub async fn list_visible_file_paths(
    database: &Database,
    user_id: i64,
    folder_id: Option<i64>,
) -> Result<Vec<String>> {
    let mut q = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::FilePath)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id));

    if let Some(fid) = folder_id {
        q = q.filter(entity::music_folders::Column::Id.eq(fid));
    }

    q.into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// Aggregate play statistics (count + last played) for a specific song.
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct SongPlayCountAndLast {
    pub play_count: i64,
    pub last_played: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn get_song_play_count_and_last(
    database: &Database,
    user_id: i64,
    song_id: &str,
) -> Result<SongPlayCountAndLast> {
    // Aggregate `play_count` (sum) rather than counting scrobble rows, and
    // restrict to submission scrobbles, so the returned play count matches
    // what the scrobbles-based list filters (e.g. forgotten-favorites'
    // `minPlays`) compute via `fetch_song_play_stats_rows`.
    let row: Option<SongPlayCountAndLast> = entity::scrobbles::Entity::find()
        .select_only()
        .expr_as(
            Expr::expr(Func::coalesce([
                Expr::col(entity::scrobbles::Column::PlayCount).sum(),
                Expr::val(0_i64).into(),
            ]))
            .cast_as(sea_orm::sea_query::Alias::new("BIGINT")),
            "play_count",
        )
        .expr_as(entity::scrobbles::Column::PlayedAt.max(), "last_played")
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::SongId.eq(song_id))
        .filter(entity::scrobbles::Column::Submission.eq(true))
        .into_model::<SongPlayCountAndLast>()
        .one(database.conn())
        .await?;
    Ok(row.unwrap_or(SongPlayCountAndLast {
        play_count: 0,
        last_played: None,
    }))
}

// ---------------------------------------------------------------------------
// Ferrotune directory helpers
// ---------------------------------------------------------------------------

/// File count + total byte size for a given music folder.
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct MusicFolderSongStats {
    pub file_count: i64,
    pub total_size: i64,
}

pub async fn get_music_folder_song_stats(
    database: &Database,
    folder_id: i64,
) -> Result<MusicFolderSongStats> {
    let row: Option<MusicFolderSongStats> = entity::songs::Entity::find()
        .select_only()
        .expr_as(entity::songs::Column::Id.count(), "file_count")
        .expr_as(
            Expr::expr(Func::coalesce([
                Expr::col(entity::songs::Column::FileSize).sum(),
                Expr::val(0_i64).into(),
            ]))
            .cast_as(sea_orm::sea_query::Alias::new("BIGINT")),
            "total_size",
        )
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_model::<MusicFolderSongStats>()
        .one(database.conn())
        .await?;
    Ok(row.unwrap_or(MusicFolderSongStats {
        file_count: 0,
        total_size: 0,
    }))
}

/// Fetch an enabled music folder by id, returning `None` if it's disabled or
/// doesn't exist.
pub async fn get_enabled_music_folder(
    database: &Database,
    folder_id: i64,
) -> Result<Option<crate::db::models::MusicFolder>> {
    entity::music_folders::Entity::find_by_id(folder_id)
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .into_model::<crate::db::models::MusicFolder>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Directory-listing row for a song under a folder path prefix.
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct DirectorySongRow {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub track_number: Option<i32>,
    pub file_size: i64,
    pub file_format: String,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub artist_id: String,
    pub artist_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectorySort {
    Name,
    Artist,
    Album,
    Year,
    Duration,
    Size,
    DateAdded,
}

#[derive(Debug, Clone, Copy)]
pub struct DirectoryPageOptions<'a> {
    pub filter: Option<&'a str>,
    pub sort: DirectorySort,
    pub descending: bool,
    pub offset: u64,
    pub limit: u64,
}

#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct DirectoryFolderRow {
    pub name: String,
    pub file_count: i64,
    pub total_size: i64,
}

#[derive(Debug)]
pub struct DirectoryFolderPage {
    pub rows: Vec<DirectoryFolderRow>,
    pub total: i64,
}

#[derive(Debug)]
pub struct DirectorySongPage {
    pub rows: Vec<DirectorySongRow>,
    pub total: i64,
    pub total_size: i64,
}

fn path_has_child_separator_expr(database: &Database, prefix: &str) -> SimpleExpr {
    let path = || Expr::col(entity::songs::Column::FilePath).into();
    let prefix = || Expr::val(prefix.to_string()).into();
    match database.sea_backend() {
        sea_orm::DbBackend::Sqlite => {
            Expr::cust_with_exprs("instr(substr(?, length(?) + 1), '/')", [path(), prefix()])
        }
        sea_orm::DbBackend::Postgres => Expr::cust_with_exprs(
            "position('/' in substring($1 from char_length($2) + 1))",
            [path(), prefix()],
        ),
        sea_orm::DbBackend::MySql => Expr::cust_with_exprs(
            "locate('/', substr(?, char_length(?) + 1))",
            [path(), prefix()],
        ),
    }
}

fn first_path_component_expr(database: &Database, prefix: &str) -> SimpleExpr {
    let path = || Expr::col(entity::songs::Column::FilePath).into();
    let prefix = || Expr::val(prefix.to_string()).into();
    match database.sea_backend() {
        sea_orm::DbBackend::Sqlite => Expr::cust_with_exprs(
            "substr(substr(?, length(?) + 1), 1, instr(substr(?, length(?) + 1), '/') - 1)",
            [path(), prefix(), path(), prefix()],
        ),
        sea_orm::DbBackend::Postgres => Expr::cust_with_exprs(
            "split_part(substring($1 from char_length($2) + 1), '/', 1)",
            [path(), prefix()],
        ),
        sea_orm::DbBackend::MySql => Expr::cust_with_exprs(
            "substring_index(substr(?, char_length(?) + 1), '/', 1)",
            [path(), prefix()],
        ),
    }
}

fn case_insensitive_directory_expr(_database: &Database, expr: SimpleExpr) -> SimpleExpr {
    SimpleExpr::FunctionCall(Func::lower(expr))
}

fn directory_filter_condition(filter: &str, columns: &[SimpleExpr]) -> Condition {
    let pattern = format!("%{}%", filter.to_lowercase());
    columns
        .iter()
        .cloned()
        .fold(Condition::any(), |condition, column| {
            condition.add(Expr::expr(Func::lower(column)).like(pattern.clone()))
        })
}

pub async fn page_directory_folders(
    database: &Database,
    folder_id: i64,
    prefix: &str,
    options: DirectoryPageOptions<'_>,
) -> Result<DirectoryFolderPage> {
    use entity::songs::Column as Song;

    let folder_name = first_path_component_expr(database, prefix);
    let total_size = Expr::col(Song::FileSize).sum().cast_as("BIGINT");
    let mut query = entity::songs::Entity::find()
        .select_only()
        .column_as(folder_name.clone(), "name")
        .column_as(Song::Id.count(), "file_count")
        .column_as(total_size.clone(), "total_size")
        .filter(Song::MusicFolderId.eq(folder_id))
        .filter(Song::MarkedForDeletionAt.is_null())
        .filter(path_has_child_separator_expr(database, prefix).gt(0))
        .group_by(folder_name.clone());

    if !prefix.is_empty() {
        query = query.filter(Song::FilePath.starts_with(prefix));
    }
    if let Some(filter) = options.filter.filter(|value| !value.trim().is_empty()) {
        query = query.filter(directory_filter_condition(
            filter,
            std::slice::from_ref(&folder_name),
        ));
    }

    let total = query.clone().count(database.conn()).await? as i64;
    let order = if options.descending {
        Order::Desc
    } else {
        Order::Asc
    };
    query = if options.sort == DirectorySort::Size {
        query.order_by(total_size, order.clone())
    } else {
        query.order_by(
            case_insensitive_directory_expr(database, folder_name.clone()),
            order.clone(),
        )
    };
    let rows = query
        .order_by(
            case_insensitive_directory_expr(database, folder_name),
            order,
        )
        .offset(options.offset)
        .limit(options.limit)
        .into_model::<DirectoryFolderRow>()
        .all(database.conn())
        .await?;

    Ok(DirectoryFolderPage { rows, total })
}

pub async fn page_directory_songs(
    database: &Database,
    folder_id: i64,
    prefix: &str,
    options: DirectoryPageOptions<'_>,
) -> Result<DirectorySongPage> {
    use entity::albums::Column as Album;
    use entity::artists::Column as Artist;
    use entity::songs::Column as Song;

    let mut query = entity::songs::Entity::find()
        .select_only()
        .column(Song::Id)
        .column(Song::FilePath)
        .column(Song::Title)
        .column(Song::AlbumId)
        .column_as(Album::Name, "album_name")
        .column(Song::Year)
        .column(Song::Genre)
        .column(Song::TrackNumber)
        .column(Song::FileSize)
        .column(Song::FileFormat)
        .column(Song::Duration)
        .column(Song::Bitrate)
        .column(Song::ArtistId)
        .column_as(Artist::Name, "artist_name")
        .column(Song::CreatedAt)
        .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(Song::MusicFolderId.eq(folder_id))
        .filter(Song::MarkedForDeletionAt.is_null())
        .filter(path_has_child_separator_expr(database, prefix).eq(0));

    if !prefix.is_empty() {
        query = query.filter(Song::FilePath.starts_with(prefix));
    }
    if let Some(filter) = options.filter.filter(|value| !value.trim().is_empty()) {
        query = query.filter(directory_filter_condition(
            filter,
            &[
                Expr::col((entity::songs::Entity, Song::Title)).into(),
                Expr::col((entity::artists::Entity, Artist::Name)).into(),
                Expr::col((entity::albums::Entity, Album::Name)).into(),
            ],
        ));
    }

    let total = query.clone().count(database.conn()).await? as i64;
    let total_size = query
        .clone()
        .select_only()
        .expr_as(
            Expr::expr(Func::coalesce([
                Expr::col((entity::songs::Entity, Song::FileSize)).sum(),
                Expr::val(0_i64).into(),
            ]))
            .cast_as("BIGINT"),
            "total_size",
        )
        .into_tuple::<i64>()
        .one(database.conn())
        .await?
        .unwrap_or(0);

    let order = if options.descending {
        Order::Desc
    } else {
        Order::Asc
    };
    query = match options.sort {
        DirectorySort::Name => query.order_by(
            case_insensitive_directory_expr(
                database,
                Expr::col((entity::songs::Entity, Song::Title)).into(),
            ),
            order.clone(),
        ),
        DirectorySort::Artist => query.order_by(
            case_insensitive_directory_expr(
                database,
                Expr::col((entity::artists::Entity, Artist::Name)).into(),
            ),
            order.clone(),
        ),
        DirectorySort::Album => query.order_by(
            case_insensitive_directory_expr(
                database,
                Expr::col((entity::albums::Entity, Album::Name)).if_null(""),
            ),
            order.clone(),
        ),
        DirectorySort::Year => query.order_by(
            Expr::col((entity::songs::Entity, Song::Year)).if_null(0),
            order.clone(),
        ),
        DirectorySort::Duration => query.order_by(
            Expr::col((entity::songs::Entity, Song::Duration)),
            order.clone(),
        ),
        DirectorySort::Size => query.order_by(
            Expr::col((entity::songs::Entity, Song::FileSize)),
            order.clone(),
        ),
        DirectorySort::DateAdded => query.order_by(
            Expr::col((entity::songs::Entity, Song::CreatedAt)),
            order.clone(),
        ),
    };
    let rows = query
        .order_by_asc(Song::Id)
        .offset(options.offset)
        .limit(options.limit)
        .into_model::<DirectorySongRow>()
        .all(database.conn())
        .await?;

    Ok(DirectorySongPage {
        rows,
        total,
        total_size,
    })
}

/// Select all songs in `folder_id` whose `file_path` begins with `prefix`,
/// ordered by `file_path`. Pass an empty prefix to match every song.
pub async fn list_directory_songs(
    database: &Database,
    folder_id: i64,
    prefix: &str,
) -> Result<Vec<DirectorySongRow>> {
    let mut q = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::FilePath)
        .column(entity::songs::Column::Title)
        .column(entity::songs::Column::AlbumId)
        .column_as(entity::albums::Column::Name, "album_name")
        .column(entity::songs::Column::Year)
        .column(entity::songs::Column::Genre)
        .column(entity::songs::Column::TrackNumber)
        .column(entity::songs::Column::FileSize)
        .column(entity::songs::Column::FileFormat)
        .column(entity::songs::Column::Duration)
        .column(entity::songs::Column::Bitrate)
        .column(entity::songs::Column::ArtistId)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column(entity::songs::Column::CreatedAt)
        .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .order_by_asc(entity::songs::Column::FilePath);

    if !prefix.is_empty() {
        q = q.filter(entity::songs::Column::FilePath.starts_with(prefix));
    }

    q.into_model::<DirectorySongRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// List `Song` rows visible to `user_id` whose `file_path` starts with
/// `prefix`, filtered to non-deleted songs under enabled folders.
pub async fn list_user_songs_by_path_prefix(
    database: &Database,
    user_id: i64,
    prefix: &str,
) -> Result<Vec<Song>> {
    let mut q = song_select(database)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .order_by_asc(entity::songs::Column::FilePath);

    if !prefix.is_empty() {
        q = q.filter(entity::songs::Column::FilePath.starts_with(prefix));
    }

    q.into_model::<Song>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{
        album_select, order_artist_albums, page_directory_folders, page_directory_songs,
        DirectoryPageOptions, DirectorySort,
    };
    use crate::db::{entity, Database};
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, DbBackend, EntityTrait, QueryTrait};

    #[test]
    fn postgres_artist_album_order_qualifies_joined_columns() {
        let sql = order_artist_albums(album_select(), DbBackend::Postgres)
            .build(DbBackend::Postgres)
            .to_string();

        assert!(sql.contains(r#"ORDER BY "albums"."year" DESC"#), "{sql}");
        assert!(sql.contains(r#"LOWER("albums"."name") ASC"#), "{sql}");
        assert!(sql.contains(r#""albums"."id" ASC"#), "{sql}");
    }

    async fn directory_database() -> Database {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("create SQLite test database");
        entity::music_folders::ActiveModel {
            id: Set(1),
            name: Set("Music".to_string()),
            path: Set("/music".to_string()),
            enabled: Set(true),
            watch_enabled: Set(false),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert music folder");
        entity::artists::ActiveModel {
            id: Set("artist".to_string()),
            name: Set("Artist".to_string()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert artist");

        let mut songs = (0..75)
            .map(|index| entity::songs::ActiveModel {
                id: Set(format!("root-{index:03}")),
                title: Set(format!("Root {index:03}")),
                artist_id: Set("artist".to_string()),
                music_folder_id: Set(Some(1)),
                duration: Set(1),
                file_path: Set(format!("root-{index:03}.mp3")),
                file_size: Set(1),
                file_format: Set("mp3".to_string()),
                ..Default::default()
            })
            .collect::<Vec<_>>();
        for folder in ["Alpha", "Beta"] {
            for index in 0..3 {
                songs.push(entity::songs::ActiveModel {
                    id: Set(format!("{folder}-{index}")),
                    title: Set(format!("{folder} {index}")),
                    artist_id: Set("artist".to_string()),
                    music_folder_id: Set(Some(1)),
                    duration: Set(1),
                    file_path: Set(format!("{folder}/song-{index}.mp3")),
                    file_size: Set(2),
                    file_format: Set("mp3".to_string()),
                    ..Default::default()
                });
            }
        }
        entity::songs::Entity::insert_many(songs)
            .exec(database.conn())
            .await
            .expect("insert directory songs");
        database
    }

    #[tokio::test]
    async fn root_directory_pages_direct_children_without_descendant_materialization() {
        let database = directory_database().await;
        let folder_page = page_directory_folders(
            &database,
            1,
            "",
            DirectoryPageOptions {
                filter: None,
                sort: DirectorySort::Name,
                descending: false,
                offset: 0,
                limit: 1,
            },
        )
        .await
        .expect("page root folders");
        assert_eq!(folder_page.rows.len(), 1, "{folder_page:?}");
        assert_eq!(folder_page.total, 2);
        assert_eq!(folder_page.rows[0].name, "Alpha");
        assert_eq!(folder_page.rows[0].file_count, 3);

        let song_page = page_directory_songs(
            &database,
            1,
            "",
            DirectoryPageOptions {
                filter: None,
                sort: DirectorySort::Name,
                descending: false,
                offset: 50,
                limit: 10,
            },
        )
        .await
        .expect("page root songs after item 50");
        assert_eq!(song_page.total, 75);
        assert_eq!(song_page.total_size, 75);
        assert_eq!(song_page.rows.len(), 10);
        assert_eq!(song_page.rows[0].id, "root-050");
        assert_eq!(song_page.rows[9].id, "root-059");
    }
}
