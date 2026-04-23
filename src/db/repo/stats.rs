//! Library statistics queries.

use sea_orm::entity::prelude::*;
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, PaginatorTrait, QueryFilter, QuerySelect,
};

use crate::db::entity;
use crate::db::repo::users;
use crate::db::Database;
use crate::error::Result;

#[derive(Debug, Clone, Copy)]
pub struct StatsSummary {
    pub song_count: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub genre_count: i64,
    pub playlist_count: i64,
    pub total_duration_seconds: i64,
    pub total_size_bytes: i64,
    pub total_plays: i64,
}

#[derive(Debug, FromQueryResult)]
struct CountRow {
    count: i64,
}

#[derive(Debug, FromQueryResult)]
struct SumRow {
    total_duration: Option<i64>,
    total_size: Option<i64>,
}

pub async fn get_user_library_stats(database: &Database, user_id: i64) -> Result<StatsSummary> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    let playlist_count = entity::playlists::Entity::find()
        .count(database.conn())
        .await? as i64;
    let total_plays = entity::scrobbles::Entity::find()
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::Submission.eq(true))
        .count(database.conn())
        .await? as i64;

    if folder_ids.is_empty() {
        return Ok(StatsSummary {
            song_count: 0,
            album_count: 0,
            artist_count: 0,
            genre_count: 0,
            playlist_count,
            total_duration_seconds: 0,
            total_size_bytes: 0,
            total_plays,
        });
    }

    let song_count = entity::songs::Entity::find()
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.clone()))
        .count(database.conn())
        .await? as i64;

    let album_count = entity::songs::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::songs::Column::AlbumId).count_distinct(),
            "count",
        )
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.clone()))
        .into_model::<CountRow>()
        .one(database.conn())
        .await?
        .map(|row| row.count)
        .unwrap_or(0);

    let artist_count = entity::songs::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::songs::Column::ArtistId).count_distinct(),
            "count",
        )
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.clone()))
        .into_model::<CountRow>()
        .one(database.conn())
        .await?
        .map(|row| row.count)
        .unwrap_or(0);

    let genre_count = entity::songs::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::songs::Column::Genre).count_distinct(),
            "count",
        )
        .filter(entity::songs::Column::Genre.is_not_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.clone()))
        .into_model::<CountRow>()
        .one(database.conn())
        .await?
        .map(|row| row.count)
        .unwrap_or(0);

    let sums = entity::songs::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::songs::Column::Duration)
                .sum()
                .cast_as("BIGINT"),
            "total_duration",
        )
        .column_as(
            Expr::col(entity::songs::Column::FileSize)
                .sum()
                .cast_as("BIGINT"),
            "total_size",
        )
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids))
        .into_model::<SumRow>()
        .one(database.conn())
        .await?
        .unwrap_or(SumRow {
            total_duration: None,
            total_size: None,
        });

    Ok(StatsSummary {
        song_count,
        album_count,
        artist_count,
        genre_count,
        playlist_count,
        total_duration_seconds: sums.total_duration.unwrap_or(0),
        total_size_bytes: sums.total_size.unwrap_or(0),
        total_plays,
    })
}
