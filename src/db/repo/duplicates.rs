//! SeaORM-backed duplicate-detection queries.

use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

/// One row per song that has a computed `full_file_hash`.
#[derive(Debug, Clone, FromQueryResult)]
pub struct DuplicateCandidateRow {
    pub full_file_hash: String,
    pub id: String,
    pub file_path: String,
    pub file_size: i64,
    pub title: String,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub folder_name: String,
}

/// List every song that has a non-null `full_file_hash`, joined with its
/// artist/album/folder metadata. The caller groups by hash to surface
/// duplicates.
pub async fn list_hash_candidates(database: &Database) -> Result<Vec<DuplicateCandidateRow>> {
    entity::songs::Entity::find()
        .select_only()
        .column_as(entity::songs::Column::FullFileHash, "full_file_hash")
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::FilePath)
        .column(entity::songs::Column::FileSize)
        .column(entity::songs::Column::Title)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column_as(entity::albums::Column::Name, "album_name")
        .column_as(entity::music_folders::Column::Name, "folder_name")
        .join(JoinType::InnerJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .filter(entity::songs::Column::FullFileHash.is_not_null())
        .order_by(entity::songs::Column::FullFileHash, Order::Asc)
        .order_by(entity::songs::Column::FilePath, Order::Asc)
        .into_model::<DuplicateCandidateRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}
