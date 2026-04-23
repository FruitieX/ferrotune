//! Music folder repository queries.
//!
//! SeaORM replacements for `src/api/ferrotune/music_folders.rs`. Exposes
//! CRUD + stats helpers plus the bulk/orphan cleanup operations used when a
//! music folder is deleted.

use sea_orm::sea_query::{Alias, Expr, Func, Query};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, Order, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};

use crate::db::entity;
use crate::db::models::MusicFolder;
use crate::db::Database;
use crate::error::Result;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

pub async fn id_by_path(database: &Database, path: &str) -> Result<Option<i64>> {
    entity::music_folders::Entity::find()
        .select_only()
        .column(entity::music_folders::Column::Id)
        .filter(entity::music_folders::Column::Path.eq(path))
        .into_tuple::<i64>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn exists_by_id(database: &Database, id: i64) -> Result<bool> {
    let found: Option<i64> = entity::music_folders::Entity::find_by_id(id)
        .select_only()
        .column(entity::music_folders::Column::Id)
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(found.is_some())
}

pub async fn find_by_id(database: &Database, id: i64) -> Result<Option<MusicFolder>> {
    entity::music_folders::Entity::find_by_id(id)
        .into_model::<MusicFolder>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_all_ordered_by_id(database: &Database) -> Result<Vec<MusicFolder>> {
    entity::music_folders::Entity::find()
        .order_by(entity::music_folders::Column::Id, Order::Asc)
        .into_model::<MusicFolder>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_watch_enabled(database: &Database) -> Result<Vec<MusicFolder>> {
    entity::music_folders::Entity::find()
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::music_folders::Column::WatchEnabled.eq(true))
        .into_model::<MusicFolder>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn create(
    database: &Database,
    name: &str,
    path: &str,
    watch_enabled: bool,
) -> Result<i64> {
    let model = entity::music_folders::ActiveModel {
        name: ActiveValue::Set(name.to_string()),
        path: ActiveValue::Set(path.to_string()),
        enabled: ActiveValue::Set(true),
        watch_enabled: ActiveValue::Set(watch_enabled),
        ..Default::default()
    };
    let inserted = model.insert(database.conn()).await?;
    Ok(inserted.id)
}

pub async fn grant_user_access(
    database: &Database,
    user_id: i64,
    music_folder_id: i64,
) -> Result<()> {
    use sea_orm::sea_query::OnConflict;

    let model = entity::user_library_access::ActiveModel {
        user_id: ActiveValue::Set(user_id),
        music_folder_id: ActiveValue::Set(music_folder_id),
        ..Default::default()
    };

    entity::user_library_access::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                entity::user_library_access::Column::UserId,
                entity::user_library_access::Column::MusicFolderId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(database.conn())
        .await?;
    Ok(())
}

pub async fn update_name(database: &Database, id: i64, name: &str) -> Result<()> {
    entity::music_folders::Entity::update_many()
        .col_expr(
            entity::music_folders::Column::Name,
            Expr::value(name.to_string()),
        )
        .filter(entity::music_folders::Column::Id.eq(id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn update_enabled(database: &Database, id: i64, enabled: bool) -> Result<()> {
    entity::music_folders::Entity::update_many()
        .col_expr(entity::music_folders::Column::Enabled, Expr::value(enabled))
        .filter(entity::music_folders::Column::Id.eq(id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn update_watch_enabled(database: &Database, id: i64, watch_enabled: bool) -> Result<()> {
    entity::music_folders::Entity::update_many()
        .col_expr(
            entity::music_folders::Column::WatchEnabled,
            Expr::value(watch_enabled),
        )
        .filter(entity::music_folders::Column::Id.eq(id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_by_id(database: &Database, id: i64) -> Result<()> {
    entity::music_folders::Entity::delete_by_id(id)
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Set `last_scanned_at = now` and clear any previous `scan_error`.
pub async fn set_scan_success(database: &Database, folder_id: i64) -> Result<()> {
    entity::music_folders::Entity::update_many()
        .col_expr(
            entity::music_folders::Column::LastScannedAt,
            Expr::value(chrono::Utc::now()),
        )
        .col_expr(
            entity::music_folders::Column::ScanError,
            Expr::value(Option::<String>::None),
        )
        .filter(entity::music_folders::Column::Id.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Record a scan error on the folder.
pub async fn set_scan_error(database: &Database, folder_id: i64, error: &str) -> Result<()> {
    entity::music_folders::Entity::update_many()
        .col_expr(
            entity::music_folders::Column::ScanError,
            Expr::value(error.to_string()),
        )
        .filter(entity::music_folders::Column::Id.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_user_access_for_folder(database: &Database, folder_id: i64) -> Result<()> {
    entity::user_library_access::Entity::delete_many()
        .filter(entity::user_library_access::Column::MusicFolderId.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// ID enumeration for bulk-delete
// ---------------------------------------------------------------------------

pub async fn list_song_ids_for_folder(database: &Database, folder_id: i64) -> Result<Vec<String>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_distinct_album_ids_for_folder(
    database: &Database,
    folder_id: i64,
) -> Result<Vec<String>> {
    let rows: Vec<Option<String>> = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::AlbumId)
        .distinct()
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_tuple::<Option<String>>()
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().flatten().collect())
}

pub async fn list_distinct_artist_ids_for_folder(
    database: &Database,
    folder_id: i64,
) -> Result<Vec<String>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::ArtistId)
        .distinct()
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Bulk delete by song ids
// ---------------------------------------------------------------------------

pub async fn delete_scrobbles_for_songs(database: &Database, song_ids: &[String]) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }
    entity::scrobbles::Entity::delete_many()
        .filter(entity::scrobbles::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_listening_sessions_for_songs(
    database: &Database,
    song_ids: &[String],
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }
    entity::listening_sessions::Entity::delete_many()
        .filter(entity::listening_sessions::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_ratings_for_item_type(
    database: &Database,
    item_type: &str,
    item_ids: &[String],
) -> Result<()> {
    if item_ids.is_empty() {
        return Ok(());
    }
    entity::ratings::Entity::delete_many()
        .filter(entity::ratings::Column::ItemType.eq(item_type))
        .filter(entity::ratings::Column::ItemId.is_in(item_ids.iter().cloned()))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_shuffle_excludes_for_songs(
    database: &Database,
    song_ids: &[String],
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }
    entity::shuffle_excludes::Entity::delete_many()
        .filter(entity::shuffle_excludes::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_play_queue_entries_for_songs(
    database: &Database,
    song_ids: &[String],
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }
    entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Orphan cleanup
// ---------------------------------------------------------------------------

/// Subquery: `SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL`
fn distinct_non_null_album_ids_subquery() -> sea_orm::sea_query::SelectStatement {
    Query::select()
        .distinct()
        .column(entity::songs::Column::AlbumId)
        .from(entity::songs::Entity)
        .and_where(Expr::col(entity::songs::Column::AlbumId).is_not_null())
        .to_owned()
}

/// Subquery: `SELECT DISTINCT artist_id FROM songs`
fn distinct_artist_ids_subquery() -> sea_orm::sea_query::SelectStatement {
    Query::select()
        .distinct()
        .column(entity::songs::Column::ArtistId)
        .from(entity::songs::Entity)
        .to_owned()
}

/// Delete rows from `starred` / `ratings` where `item_type = 'album'` and
/// `item_id` is in `album_ids` **and** no longer referenced by any song.
pub async fn cleanup_orphan_album_related(database: &Database, album_ids: &[String]) -> Result<()> {
    if album_ids.is_empty() {
        return Ok(());
    }

    entity::starred::Entity::delete_many()
        .filter(entity::starred::Column::ItemType.eq("album"))
        .filter(entity::starred::Column::ItemId.is_in(album_ids.iter().cloned()))
        .filter(
            entity::starred::Column::ItemId.not_in_subquery(distinct_non_null_album_ids_subquery()),
        )
        .exec(database.conn())
        .await?;

    entity::ratings::Entity::delete_many()
        .filter(entity::ratings::Column::ItemType.eq("album"))
        .filter(entity::ratings::Column::ItemId.is_in(album_ids.iter().cloned()))
        .filter(
            entity::ratings::Column::ItemId.not_in_subquery(distinct_non_null_album_ids_subquery()),
        )
        .exec(database.conn())
        .await?;

    entity::albums::Entity::delete_many()
        .filter(entity::albums::Column::Id.is_in(album_ids.iter().cloned()))
        .filter(entity::albums::Column::Id.not_in_subquery(distinct_non_null_album_ids_subquery()))
        .exec(database.conn())
        .await?;

    Ok(())
}

/// Delete rows from `starred` / `ratings` / `artists` where the artist is in
/// `artist_ids` and is no longer referenced by any song.
pub async fn cleanup_orphan_artist_related(
    database: &Database,
    artist_ids: &[String],
) -> Result<()> {
    if artist_ids.is_empty() {
        return Ok(());
    }

    entity::starred::Entity::delete_many()
        .filter(entity::starred::Column::ItemType.eq("artist"))
        .filter(entity::starred::Column::ItemId.is_in(artist_ids.iter().cloned()))
        .filter(entity::starred::Column::ItemId.not_in_subquery(distinct_artist_ids_subquery()))
        .exec(database.conn())
        .await?;

    entity::ratings::Entity::delete_many()
        .filter(entity::ratings::Column::ItemType.eq("artist"))
        .filter(entity::ratings::Column::ItemId.is_in(artist_ids.iter().cloned()))
        .filter(entity::ratings::Column::ItemId.not_in_subquery(distinct_artist_ids_subquery()))
        .exec(database.conn())
        .await?;

    entity::artists::Entity::delete_many()
        .filter(entity::artists::Column::Id.is_in(artist_ids.iter().cloned()))
        .filter(entity::artists::Column::Id.not_in_subquery(distinct_artist_ids_subquery()))
        .exec(database.conn())
        .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

pub async fn count_songs(database: &Database, folder_id: i64) -> Result<i64> {
    entity::songs::Entity::find()
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .count(database.conn())
        .await
        .map(|c| c as i64)
        .map_err(Into::into)
}

pub async fn count_distinct_albums(database: &Database, folder_id: i64) -> Result<i64> {
    let count: Option<i64> = entity::songs::Entity::find()
        .select_only()
        .expr_as(
            Expr::expr(Expr::col(entity::songs::Column::AlbumId)).count_distinct(),
            "c",
        )
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(count.unwrap_or(0))
}

pub async fn count_distinct_artists(database: &Database, folder_id: i64) -> Result<i64> {
    // `artist_id` is NOT NULL in schema; keep the filter for parity.
    let count: Option<i64> = entity::songs::Entity::find()
        .select_only()
        .expr_as(
            Expr::expr(Expr::col(entity::songs::Column::ArtistId)).count_distinct(),
            "c",
        )
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(count.unwrap_or(0))
}

#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct DurationSizeSums {
    pub total_duration: Option<i64>,
    pub total_size: Option<i64>,
}

pub async fn sum_duration_and_size(
    database: &Database,
    folder_id: i64,
) -> Result<DurationSizeSums> {
    // SUM(duration) in Postgres returns NUMERIC for integer sums, so cast to
    // BIGINT to match the existing raw-SQL projection.
    let big = Alias::new("BIGINT");
    let row: Option<DurationSizeSums> = entity::songs::Entity::find()
        .select_only()
        .expr_as(
            Expr::expr(Expr::col(entity::songs::Column::Duration).sum()).cast_as(big.clone()),
            "total_duration",
        )
        .expr_as(
            Expr::expr(Expr::col(entity::songs::Column::FileSize).sum()).cast_as(big.clone()),
            "total_size",
        )
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_model::<DurationSizeSums>()
        .one(database.conn())
        .await?;
    Ok(row.unwrap_or(DurationSizeSums {
        total_duration: None,
        total_size: None,
    }))
}

// Silence `Func` unused-import on certain feature combos.
#[allow(dead_code)]
fn _func_unused() -> sea_orm::sea_query::FunctionCall {
    Func::count(Expr::val(1))
}
