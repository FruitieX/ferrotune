//! Soft-delete (recycle bin) queries for songs marked for deletion.

use chrono::{DateTime, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, RelationTrait,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

/// Count of songs currently in the recycle bin.
pub async fn count_marked_for_deletion(database: &Database) -> Result<i64> {
    let n = entity::songs::Entity::find()
        .filter(entity::songs::Column::MarkedForDeletionAt.is_not_null())
        .count(database.conn())
        .await?;
    Ok(n as i64)
}

/// Mark a song for deletion only if it is not already marked. Returns
/// `true` when the row transitioned from "not marked" to "marked".
pub async fn mark_for_deletion(
    database: &Database,
    song_id: &str,
    at: DateTime<Utc>,
) -> Result<bool> {
    let res = entity::songs::Entity::update_many()
        .col_expr(entity::songs::Column::MarkedForDeletionAt, Expr::value(at))
        .filter(entity::songs::Column::Id.eq(song_id))
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .exec(database.conn())
        .await?;
    Ok(res.rows_affected > 0)
}

/// Restore a song from the recycle bin if it is currently marked.
/// Returns true when the row was restored.
pub async fn restore(database: &Database, song_id: &str) -> Result<bool> {
    let res = entity::songs::Entity::update_many()
        .col_expr(
            entity::songs::Column::MarkedForDeletionAt,
            Expr::value(Option::<DateTime<Utc>>::None),
        )
        .filter(entity::songs::Column::Id.eq(song_id))
        .filter(entity::songs::Column::MarkedForDeletionAt.is_not_null())
        .exec(database.conn())
        .await?;
    Ok(res.rows_affected > 0)
}

/// Fetch a page of recycle-bin songs joined with artist/album metadata.
/// The `days_remaining` field is not computed here; callers derive it
/// from `marked_for_deletion_at` + a retention constant.
pub async fn list_marked_for_deletion<T: FromQueryResult>(
    database: &Database,
    limit: i64,
    offset: i64,
) -> Result<Vec<T>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::Title)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column_as(entity::albums::Column::Name, "album_name")
        .column(entity::songs::Column::Duration)
        .column(entity::songs::Column::FilePath)
        .column(entity::songs::Column::FileSize)
        .column(entity::songs::Column::CoverArtHash)
        .column(entity::songs::Column::MarkedForDeletionAt)
        .join(JoinType::InnerJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(entity::songs::Column::MarkedForDeletionAt.is_not_null())
        .order_by(entity::songs::Column::MarkedForDeletionAt, Order::Desc)
        .limit(limit as u64)
        .offset(offset as u64)
        .into_model::<T>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch song + folder path metadata used by the permanent-delete flow.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SongDeletionRow {
    pub file_path: String,
    pub folder_path: String,
    pub marked_for_deletion_at: Option<DateTime<Utc>>,
}

pub async fn get_song_for_permanent_delete(
    database: &Database,
    song_id: &str,
) -> Result<Option<SongDeletionRow>> {
    entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::FilePath)
        .column_as(entity::music_folders::Column::Path, "folder_path")
        .column(entity::songs::Column::MarkedForDeletionAt)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .into_model::<SongDeletionRow>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch all song ids currently in the recycle bin.
pub async fn list_all_marked_ids(database: &Database) -> Result<Vec<String>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_not_null())
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch ids of songs marked for deletion whose retention period has elapsed.
pub async fn list_expired_marked_ids(
    database: &Database,
    cutoff: DateTime<Utc>,
) -> Result<Vec<String>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_not_null())
        .filter(entity::songs::Column::MarkedForDeletionAt.lt(cutoff))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}
