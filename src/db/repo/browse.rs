//! Browse queries: artists, albums, songs.
//!
//! SeaORM replacement for the browse-related bodies in `src/db/queries.rs`.
//! This module now uses SeaORM query-builder and Entity patterns for the
//! browse read surface, including the song list/read queries. Aggregated play
//! stats are composed via the shared scrobble repo helpers instead of inline
//! dialect-specific SQL.

use sea_orm::sea_query::{Expr, Func, SimpleExpr};
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, JoinType, Order, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, RelationTrait, Value,
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

pub(crate) fn apply_song_play_stats(songs: &mut [Song], stats: Vec<SongPlayStatsRow>) {
    let stats_by_song = stats
        .into_iter()
        .map(|row| {
            let song_id = row.song_id.clone();
            (song_id, row)
        })
        .collect::<HashMap<_, _>>();

    for song in songs {
        if let Some(row) = stats_by_song.get(&song.id) {
            song.play_count = Some(row.play_count);
            song.last_played = row.last_played;
        } else {
            song.play_count = None;
            song.last_played = None;
        }
        song.starred_at = None;
    }
}

fn apply_song_library_status_play_stats(
    songs: &mut [SongWithLibraryStatus],
    stats: Vec<SongPlayStatsRow>,
) {
    let stats_by_song = stats
        .into_iter()
        .map(|row| {
            let song_id = row.song_id.clone();
            (song_id, row)
        })
        .collect::<HashMap<_, _>>();

    for song in songs {
        if let Some(row) = stats_by_song.get(&song.id) {
            song.play_count = Some(row.play_count);
            song.last_played = row.last_played;
        } else {
            song.play_count = None;
            song.last_played = None;
        }
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
    apply_song_play_stats(&mut songs, stats);

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
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?;
    apply_song_play_stats(&mut songs, stats);

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
    apply_song_play_stats(&mut songs, stats);

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
    apply_song_play_stats(&mut songs, stats);

    Ok(songs)
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
    apply_song_library_status_play_stats(&mut songs, stats);

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
    let row: Option<SongPlayCountAndLast> = entity::scrobbles::Entity::find()
        .select_only()
        .expr_as(entity::scrobbles::Column::Id.count(), "play_count")
        .expr_as(entity::scrobbles::Column::PlayedAt.max(), "last_played")
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::SongId.eq(song_id))
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
