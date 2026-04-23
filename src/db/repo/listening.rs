//! Listening-session queries for the Ferrotune admin API basic flows.

use chrono::{DateTime, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, FromQueryResult, PaginatorTrait,
    QueryFilter, QuerySelect,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy)]
pub struct ListeningStatsSummary {
    pub total_seconds: i64,
    pub session_count: i64,
    pub unique_songs: i64,
    pub skip_count: i64,
    pub scrobble_count: i64,
}

#[derive(Debug, FromQueryResult)]
struct CountRow {
    count: i64,
}

#[derive(Debug, FromQueryResult)]
struct SumRow {
    total: Option<i64>,
}

fn duration_seconds_to_i32(duration_seconds: i64) -> Result<i32> {
    i32::try_from(duration_seconds)
        .map_err(|_| Error::InvalidRequest("duration_seconds is out of range".to_string()))
}

fn listening_sessions_for_period(
    user_id: i64,
    start: Option<DateTime<Utc>>,
) -> sea_orm::Select<entity::listening_sessions::Entity> {
    let mut query = entity::listening_sessions::Entity::find()
        .filter(entity::listening_sessions::Column::UserId.eq(user_id));

    if let Some(start) = start {
        query =
            query.filter(entity::listening_sessions::Column::ListenedAt.gte(start.fixed_offset()));
    }

    query
}

fn scrobbles_for_period(
    user_id: i64,
    start: Option<DateTime<Utc>>,
) -> sea_orm::Select<entity::scrobbles::Entity> {
    let mut query = entity::scrobbles::Entity::find()
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::Submission.eq(true));

    if let Some(start) = start {
        query = query.filter(entity::scrobbles::Column::PlayedAt.gte(start.fixed_offset()));
    }

    query
}

pub async fn song_exists(database: &Database, song_id: &str) -> Result<bool> {
    Ok(entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::Id)
        .into_tuple::<String>()
        .one(database.conn())
        .await?
        .is_some())
}

pub async fn update_listening_session(
    database: &Database,
    session_id: i64,
    user_id: i64,
    song_id: &str,
    duration_seconds: i64,
    skipped: bool,
) -> Result<bool> {
    let duration_seconds = duration_seconds_to_i32(duration_seconds)?;

    let result = entity::listening_sessions::Entity::update_many()
        .col_expr(
            entity::listening_sessions::Column::DurationSeconds,
            Expr::value(duration_seconds),
        )
        .col_expr(
            entity::listening_sessions::Column::Skipped,
            Expr::value(skipped),
        )
        .filter(entity::listening_sessions::Column::Id.eq(session_id))
        .filter(entity::listening_sessions::Column::UserId.eq(user_id))
        .filter(entity::listening_sessions::Column::SongId.eq(song_id))
        .exec(database.conn())
        .await?;

    Ok(result.rows_affected > 0)
}

pub async fn create_listening_session(
    database: &Database,
    user_id: i64,
    song_id: &str,
    duration_seconds: i64,
    skipped: bool,
) -> Result<i64> {
    let duration_seconds = duration_seconds_to_i32(duration_seconds)?;

    let inserted = entity::listening_sessions::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id.to_string()),
        duration_seconds: Set(duration_seconds),
        skipped: Set(skipped),
        listened_at: Set(Utc::now().fixed_offset()),
        ..Default::default()
    }
    .insert(database.conn())
    .await?;

    Ok(inserted.id)
}

pub async fn get_listening_stats_for_period(
    database: &Database,
    user_id: i64,
    start: Option<DateTime<Utc>>,
) -> Result<ListeningStatsSummary> {
    let session_count = listening_sessions_for_period(user_id, start)
        .count(database.conn())
        .await? as i64;

    let unique_songs = listening_sessions_for_period(user_id, start)
        .select_only()
        .column_as(
            Expr::col(entity::listening_sessions::Column::SongId).count_distinct(),
            "count",
        )
        .into_model::<CountRow>()
        .one(database.conn())
        .await?
        .map(|row| row.count)
        .unwrap_or(0);

    let skip_count = listening_sessions_for_period(user_id, start)
        .filter(entity::listening_sessions::Column::Skipped.eq(true))
        .count(database.conn())
        .await? as i64;

    let total_seconds = listening_sessions_for_period(user_id, start)
        .select_only()
        .column_as(
            Expr::col(entity::listening_sessions::Column::DurationSeconds)
                .sum()
                .cast_as("BIGINT"),
            "total",
        )
        .into_model::<SumRow>()
        .one(database.conn())
        .await?
        .and_then(|row| row.total)
        .unwrap_or(0);

    let scrobble_count = scrobbles_for_period(user_id, start)
        .select_only()
        .column_as(
            Expr::col(entity::scrobbles::Column::PlayCount)
                .sum()
                .cast_as("BIGINT"),
            "total",
        )
        .into_model::<SumRow>()
        .one(database.conn())
        .await?
        .and_then(|row| row.total)
        .unwrap_or(0);

    Ok(ListeningStatsSummary {
        total_seconds,
        session_count,
        unique_songs,
        skip_count,
        scrobble_count,
    })
}
