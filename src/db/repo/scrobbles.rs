//! Scrobble and listening-session queries used by the Ferrotune admin API.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayStatsAggregation {
    CountRows,
    SumPlayCount,
}

#[derive(Debug, Clone)]
pub struct SongPlayStatsRow {
    pub song_id: String,
    pub play_count: i64,
    pub last_played: Option<DateTime<Utc>>,
}

#[derive(Debug, FromQueryResult)]
struct DuplicateImportStatsRow {
    song_count: i64,
    total_plays: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct SongPlayCountRow {
    song_id: String,
    play_count: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct SongPlayStatsQueryRow {
    song_id: String,
    play_count: Option<i64>,
    last_played: Option<DateTime<Utc>>,
}

pub async fn fetch_existing_song_ids(
    database: &Database,
    song_ids: &[&str],
) -> Result<Vec<String>> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::Id.is_in(song_ids.iter().copied().map(str::to_string)))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn delete_scrobbles_for_song_ids(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    entity::scrobbles::Entity::delete_many()
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn delete_listening_sessions_for_song_ids(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    entity::listening_sessions::Entity::delete_many()
        .filter(entity::listening_sessions::Column::UserId.eq(user_id))
        .filter(entity::listening_sessions::Column::SongId.is_in(song_ids.iter().cloned()))
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn fetch_duplicate_import_stats(
    database: &Database,
    user_id: i64,
    description: &str,
) -> Result<Option<(i64, i64)>> {
    let row = entity::scrobbles::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::scrobbles::Column::SongId).count_distinct(),
            "song_count",
        )
        .column_as(
            Expr::col(entity::scrobbles::Column::PlayCount)
                .sum()
                .cast_as("BIGINT"),
            "total_plays",
        )
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::Description.eq(description))
        .into_model::<DuplicateImportStatsRow>()
        .one(database.conn())
        .await?;

    Ok(row.map(|row| (row.song_count, row.total_plays.unwrap_or(0))))
}

pub async fn fetch_song_play_count_rows(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<Vec<(String, i64)>> {
    Ok(fetch_song_play_stats_rows(
        database,
        Some(user_id),
        song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?
    .into_iter()
    .map(|row| (row.song_id, row.play_count))
    .collect())
}

pub async fn fetch_song_play_stats_rows(
    database: &Database,
    user_id: Option<i64>,
    song_ids: &[String],
    aggregation: PlayStatsAggregation,
) -> Result<Vec<SongPlayStatsRow>> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }

    let play_count_expr = match aggregation {
        PlayStatsAggregation::CountRows => Expr::col(entity::scrobbles::Column::Id)
            .count()
            .cast_as("BIGINT"),
        PlayStatsAggregation::SumPlayCount => Expr::col(entity::scrobbles::Column::PlayCount)
            .sum()
            .cast_as("BIGINT"),
    };

    let mut query = entity::scrobbles::Entity::find()
        .select_only()
        .column(entity::scrobbles::Column::SongId)
        .column_as(play_count_expr, "play_count")
        .column_as(
            Expr::col(entity::scrobbles::Column::PlayedAt).max(),
            "last_played",
        )
        .filter(entity::scrobbles::Column::Submission.eq(true))
        .filter(entity::scrobbles::Column::SongId.is_in(song_ids.iter().cloned()));

    if let Some(user_id) = user_id {
        query = query.filter(entity::scrobbles::Column::UserId.eq(user_id));
    }

    let rows = query
        .group_by(entity::scrobbles::Column::SongId)
        .into_model::<SongPlayStatsQueryRow>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| SongPlayStatsRow {
            song_id: row.song_id,
            play_count: row.play_count.unwrap_or(0),
            last_played: row.last_played,
        })
        .collect())
}

pub async fn insert_import_scrobble_row(
    database: &Database,
    user_id: i64,
    song_id: &str,
    played_at: Option<DateTime<Utc>>,
    play_count: i32,
    description: Option<String>,
) -> Result<()> {
    let model = entity::scrobbles::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id.to_string()),
        played_at: Set(played_at.map(|value| value.fixed_offset())),
        submission: Set(true),
        play_count: Set(i64::from(play_count)),
        description: Set(description),
        queue_source_type: Set(None),
        queue_source_id: Set(None),
        ..Default::default()
    };

    entity::scrobbles::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn insert_listening_session_row(
    database: &Database,
    user_id: i64,
    song_id: &str,
    duration_seconds: i32,
    listened_at: DateTime<Utc>,
) -> Result<()> {
    let model = entity::listening_sessions::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id.to_string()),
        duration_seconds: Set(duration_seconds),
        listened_at: Set(listened_at.fixed_offset()),
        skipped: Set(false),
        ..Default::default()
    };

    entity::listening_sessions::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(())
}
