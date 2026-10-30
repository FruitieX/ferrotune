//! Raw listening-history management queries.

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, Statement, Value,
    Values,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryEntryKind {
    Scrobble,
    Session,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryEntryKinds {
    pub scrobbles: bool,
    pub sessions: bool,
}

impl HistoryEntryKinds {
    pub fn all() -> Self {
        Self {
            scrobbles: true,
            sessions: true,
        }
    }

    pub fn from_kinds(kinds: &[HistoryEntryKind]) -> Self {
        Self {
            scrobbles: kinds.contains(&HistoryEntryKind::Scrobble),
            sessions: kinds.contains(&HistoryEntryKind::Session),
        }
    }

    fn is_empty(self) -> bool {
        !self.scrobbles && !self.sessions
    }
}

#[derive(Debug, Clone, Default)]
pub struct HistoryEntryFilter {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub min_duration_seconds: Option<i32>,
    pub max_duration_seconds: Option<i32>,
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct HistoryEntryRow {
    pub kind: String,
    pub id: i64,
    pub song_id: String,
    pub event_at: Option<DateTime<Utc>>,
    pub duration_seconds: Option<i32>,
    pub skipped: Option<bool>,
    pub play_count: Option<i64>,
    pub description: Option<String>,
    pub submission: Option<bool>,
    pub queue_source_type: Option<String>,
    pub queue_source_id: Option<String>,
    /// Combined listing: the scrobble paired with this session (same play).
    pub scrobble_id: Option<i64>,
}

#[derive(Debug, Clone, FromQueryResult)]
struct CountRow {
    count: i64,
}

#[derive(Debug, Clone)]
pub struct HistoryEntryPage {
    pub rows: Vec<HistoryEntryRow>,
    pub total: i64,
}

fn is_postgres(database: &Database) -> bool {
    matches!(database.sea_backend(), sea_orm::DbBackend::Postgres)
}

fn push_bind(sql: &mut String, binds: &mut Vec<Value>, value: impl Into<Value>, pg: bool) {
    binds.push(value.into());
    if pg {
        sql.push('$');
        sql.push_str(&binds.len().to_string());
    } else {
        sql.push('?');
    }
}

fn push_timestamp_filters(
    sql: &mut String,
    binds: &mut Vec<Value>,
    column: &str,
    filter: &HistoryEntryFilter,
    pg: bool,
) {
    if let Some(from) = filter.from {
        sql.push_str(" AND ");
        sql.push_str(column);
        sql.push_str(" >= ");
        push_bind(sql, binds, from.fixed_offset(), pg);
    }

    if let Some(to) = filter.to {
        sql.push_str(" AND ");
        sql.push_str(column);
        sql.push_str(" <= ");
        push_bind(sql, binds, to.fixed_offset(), pg);
    }
}

fn push_duration_filters(
    sql: &mut String,
    binds: &mut Vec<Value>,
    column: &str,
    filter: &HistoryEntryFilter,
    pg: bool,
) {
    if let Some(min_duration_seconds) = filter.min_duration_seconds {
        sql.push_str(" AND ");
        sql.push_str(column);
        sql.push_str(" >= ");
        push_bind(sql, binds, min_duration_seconds, pg);
    }

    if let Some(max_duration_seconds) = filter.max_duration_seconds {
        sql.push_str(" AND ");
        sql.push_str(column);
        sql.push_str(" <= ");
        push_bind(sql, binds, max_duration_seconds, pg);
    }
}

/// Seconds between scrobble `c` and session `l`. A play's scrobble is
/// recorded partway through it and its session at the start (web) or the end
/// (native app), so the two lie within the session's duration of each other.
fn scrobble_session_gap(c: &str, l: &str, pg: bool) -> String {
    if pg {
        format!("ABS(EXTRACT(EPOCH FROM ({c}.played_at - {l}.listened_at)))")
    } else {
        format!("ABS(julianday({c}.played_at) - julianday({l}.listened_at)) * 86400.0")
    }
}

/// Slack on top of the session's duration when pairing it with a scrobble.
const PAIRING_GRACE_SECS: i32 = 120;

fn pairs_with(c: &str, l: &str, pg: bool) -> String {
    format!(
        "{c}.user_id = {l}.user_id AND {c}.song_id = {l}.song_id AND {gap} <= {l}.duration_seconds + {PAIRING_GRACE_SECS}",
        gap = scrobble_session_gap(c, l, pg),
    )
}

/// Sessions with the scrobble of the same play, if any (`combine`): the
/// nearest scrobble in the window, so back-to-back repeats of a song each get
/// their own. (SQLite rejects an outer column in a correlated subquery's
/// ORDER BY here, so the nearest one is picked with MIN over gap and id.)
fn build_paired_session_select(
    user_id: i64,
    filter: &HistoryEntryFilter,
    binds: &mut Vec<Value>,
    pg: bool,
) -> String {
    let mut sql = format!(
        "SELECT 'session' AS kind, l.id, l.song_id, l.listened_at AS event_at, \
         l.duration_seconds, l.skipped, c.play_count, c.description, c.submission, \
         c.queue_source_type, c.queue_source_id, c.id AS scrobble_id \
         FROM listening_sessions l \
         LEFT JOIN scrobbles c ON c.id = (SELECT MIN(CAST({gap} AS BIGINT) * 4294967296 + c2.id) % 4294967296 \
         FROM scrobbles c2 WHERE {pairs}) \
         WHERE l.user_id = ",
        pairs = pairs_with("c2", "l", pg),
        gap = scrobble_session_gap("c2", "l", pg),
    );
    push_bind(&mut sql, binds, user_id, pg);
    push_timestamp_filters(&mut sql, binds, "l.listened_at", filter, pg);
    push_duration_filters(&mut sql, binds, "l.duration_seconds", filter, pg);
    sql
}

/// Scrobbles without a session of the same play (`combine`), e.g. imports.
fn build_unpaired_scrobble_select(
    user_id: i64,
    filter: &HistoryEntryFilter,
    binds: &mut Vec<Value>,
    pg: bool,
) -> String {
    let mut sql = String::from(
        "SELECT 'scrobble' AS kind, c.id, c.song_id, c.played_at AS event_at, \
         NULL AS duration_seconds, NULL AS skipped, c.play_count, c.description, \
         c.submission, c.queue_source_type, c.queue_source_id, NULL AS scrobble_id \
         FROM scrobbles c WHERE c.user_id = ",
    );
    push_bind(&mut sql, binds, user_id, pg);
    push_timestamp_filters(&mut sql, binds, "c.played_at", filter, pg);
    sql.push_str(&format!(
        " AND NOT EXISTS (SELECT 1 FROM listening_sessions l WHERE {})",
        pairs_with("c", "l", pg)
    ));
    sql
}

fn build_scrobble_select(
    user_id: i64,
    filter: &HistoryEntryFilter,
    binds: &mut Vec<Value>,
    pg: bool,
) -> String {
    let mut sql = String::from(
        "SELECT 'scrobble' AS kind, id, song_id, played_at AS event_at, \
         NULL AS duration_seconds, NULL AS skipped, play_count, description, \
         submission, queue_source_type, queue_source_id, NULL AS scrobble_id \
         FROM scrobbles WHERE user_id = ",
    );
    push_bind(&mut sql, binds, user_id, pg);
    push_timestamp_filters(&mut sql, binds, "played_at", filter, pg);
    sql
}

fn build_session_select(
    user_id: i64,
    filter: &HistoryEntryFilter,
    binds: &mut Vec<Value>,
    pg: bool,
) -> String {
    let mut sql = String::from(
        "SELECT 'session' AS kind, id, song_id, listened_at AS event_at, \
         duration_seconds, skipped, NULL AS play_count, NULL AS description, \
         NULL AS submission, NULL AS queue_source_type, NULL AS queue_source_id, \
         NULL AS scrobble_id \
         FROM listening_sessions WHERE user_id = ",
    );
    push_bind(&mut sql, binds, user_id, pg);
    push_timestamp_filters(&mut sql, binds, "listened_at", filter, pg);
    push_duration_filters(&mut sql, binds, "duration_seconds", filter, pg);
    sql
}

fn build_union_sql(
    user_id: i64,
    filter: &HistoryEntryFilter,
    kinds: HistoryEntryKinds,
    combine: bool,
    binds: &mut Vec<Value>,
    pg: bool,
) -> Option<String> {
    if kinds.is_empty() {
        return None;
    }
    if combine && kinds.scrobbles && kinds.sessions {
        return Some(format!(
            "{} UNION ALL {}",
            build_paired_session_select(user_id, filter, binds, pg),
            build_unpaired_scrobble_select(user_id, filter, binds, pg),
        ));
    }

    let mut parts = Vec::new();
    if kinds.scrobbles {
        parts.push(build_scrobble_select(user_id, filter, binds, pg));
    }
    if kinds.sessions {
        parts.push(build_session_select(user_id, filter, binds, pg));
    }

    Some(parts.join(" UNION ALL "))
}

async fn query_all_for_backend<T: FromQueryResult>(
    database: &Database,
    sql: &str,
    binds: Vec<Value>,
) -> std::result::Result<Vec<T>, sea_orm::DbErr> {
    let stmt = Statement::from_sql_and_values(database.sea_backend(), sql, Values(binds));
    let rows = database.conn().query_all_raw(stmt).await?;
    rows.into_iter()
        .map(|row| T::from_query_result(&row, ""))
        .collect()
}

async fn query_one_for_backend<T: FromQueryResult>(
    database: &Database,
    sql: &str,
    binds: Vec<Value>,
) -> std::result::Result<Option<T>, sea_orm::DbErr> {
    let stmt = Statement::from_sql_and_values(database.sea_backend(), sql, Values(binds));
    database
        .conn()
        .query_one_raw(stmt)
        .await?
        .map(|row| T::from_query_result(&row, ""))
        .transpose()
}

/// History entries newest first. With `combine`, a listening session and the
/// scrobble of the same play come back as one session row (`scrobble_id`).
pub async fn list_history_entries(
    database: &Database,
    user_id: i64,
    filter: &HistoryEntryFilter,
    kinds: HistoryEntryKinds,
    combine: bool,
    offset: i64,
    limit: i64,
) -> Result<HistoryEntryPage> {
    if kinds.is_empty() {
        return Ok(HistoryEntryPage {
            rows: Vec::new(),
            total: 0,
        });
    }

    let pg = is_postgres(database);

    let mut count_binds = Vec::new();
    let Some(union_sql) = build_union_sql(user_id, filter, kinds, combine, &mut count_binds, pg)
    else {
        return Ok(HistoryEntryPage {
            rows: Vec::new(),
            total: 0,
        });
    };
    let count_sql = format!("SELECT COUNT(*) AS count FROM ({union_sql}) history_entries");
    let total = query_one_for_backend::<CountRow>(database, &count_sql, count_binds)
        .await?
        .map(|row| row.count)
        .unwrap_or(0);

    if total == 0 {
        return Ok(HistoryEntryPage {
            rows: Vec::new(),
            total,
        });
    }

    let mut list_binds = Vec::new();
    let Some(union_sql) = build_union_sql(user_id, filter, kinds, combine, &mut list_binds, pg)
    else {
        return Ok(HistoryEntryPage {
            rows: Vec::new(),
            total: 0,
        });
    };
    let mut list_sql = format!(
        "SELECT * FROM ({union_sql}) history_entries \
         ORDER BY (event_at IS NULL) ASC, event_at DESC, kind ASC, id DESC LIMIT "
    );
    push_bind(&mut list_sql, &mut list_binds, limit, pg);
    list_sql.push_str(" OFFSET ");
    push_bind(&mut list_sql, &mut list_binds, offset, pg);

    let rows = query_all_for_backend::<HistoryEntryRow>(database, &list_sql, list_binds).await?;

    Ok(HistoryEntryPage { rows, total })
}

pub async fn delete_scrobbles_by_ids(
    database: &Database,
    user_id: i64,
    ids: &[i64],
) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }

    let result = entity::scrobbles::Entity::delete_many()
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::Id.is_in(ids.iter().copied()))
        .exec(database.conn())
        .await?;

    Ok(result.rows_affected)
}

pub async fn delete_listening_sessions_by_ids(
    database: &Database,
    user_id: i64,
    ids: &[i64],
) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }

    let result = entity::listening_sessions::Entity::delete_many()
        .filter(entity::listening_sessions::Column::UserId.eq(user_id))
        .filter(entity::listening_sessions::Column::Id.is_in(ids.iter().copied()))
        .exec(database.conn())
        .await?;

    Ok(result.rows_affected)
}

pub async fn delete_matching_scrobbles(
    database: &Database,
    user_id: i64,
    filter: &HistoryEntryFilter,
) -> Result<u64> {
    let mut query = entity::scrobbles::Entity::delete_many()
        .filter(entity::scrobbles::Column::UserId.eq(user_id));

    if let Some(from) = filter.from {
        query = query.filter(entity::scrobbles::Column::PlayedAt.gte(from.fixed_offset()));
    }
    if let Some(to) = filter.to {
        query = query.filter(entity::scrobbles::Column::PlayedAt.lte(to.fixed_offset()));
    }

    let result = query.exec(database.conn()).await?;
    Ok(result.rows_affected)
}

pub async fn delete_matching_listening_sessions(
    database: &Database,
    user_id: i64,
    filter: &HistoryEntryFilter,
) -> Result<u64> {
    let mut query = entity::listening_sessions::Entity::delete_many()
        .filter(entity::listening_sessions::Column::UserId.eq(user_id));

    if let Some(from) = filter.from {
        query =
            query.filter(entity::listening_sessions::Column::ListenedAt.gte(from.fixed_offset()));
    }
    if let Some(to) = filter.to {
        query = query.filter(entity::listening_sessions::Column::ListenedAt.lte(to.fixed_offset()));
    }
    if let Some(min_duration_seconds) = filter.min_duration_seconds {
        query = query
            .filter(entity::listening_sessions::Column::DurationSeconds.gte(min_duration_seconds));
    }
    if let Some(max_duration_seconds) = filter.max_duration_seconds {
        query = query
            .filter(entity::listening_sessions::Column::DurationSeconds.lte(max_duration_seconds));
    }

    let result = query.exec(database.conn()).await?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ActiveModelTrait, ActiveValue};

    async fn setup_database() -> Database {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("create sqlite memory db");
        entity::users::ActiveModel {
            id: ActiveValue::Set(1),
            username: ActiveValue::Set("history-test".to_string()),
            password_hash: ActiveValue::Set("x".to_string()),
            is_admin: ActiveValue::Set(false),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert user");
        entity::artists::ActiveModel {
            id: ActiveValue::Set("artist-1".to_string()),
            name: ActiveValue::Set("Test Artist".to_string()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert artist");
        for song_id in ["song-1", "song-2"] {
            entity::songs::ActiveModel {
                id: ActiveValue::Set(song_id.to_string()),
                title: ActiveValue::Set(song_id.to_string()),
                artist_id: ActiveValue::Set("artist-1".to_string()),
                file_path: ActiveValue::Set(format!("/tmp/{song_id}.mp3")),
                file_size: ActiveValue::Set(0),
                file_format: ActiveValue::Set("mp3".to_string()),
                ..Default::default()
            }
            .insert(database.conn())
            .await
            .expect("insert song");
        }
        database
    }

    #[tokio::test]
    async fn combined_listing_pairs_a_session_with_its_scrobble() {
        let database = setup_database().await;
        let session_id = crate::db::repo::listening::create_listening_session(
            &database, 1, "song-1", 200, false,
        )
        .await
        .unwrap();
        // Scrobbled partway through the play, before the session was stored.
        crate::api::common::scrobbling::insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            1,
            "song-1",
            Utc::now() - chrono::Duration::seconds(90),
            Some("album"),
            Some("al-1"),
        )
        .await
        .unwrap();
        // Another song's scrobble with no session (an import, say).
        crate::api::common::scrobbling::insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            1,
            "song-2",
            Utc::now() - chrono::Duration::days(3),
            None,
            None,
        )
        .await
        .unwrap();

        let raw = list_history_entries(
            &database,
            1,
            &HistoryEntryFilter::default(),
            HistoryEntryKinds::all(),
            false,
            0,
            50,
        )
        .await
        .unwrap();
        assert_eq!(raw.total, 3);

        let combined = list_history_entries(
            &database,
            1,
            &HistoryEntryFilter::default(),
            HistoryEntryKinds::all(),
            true,
            0,
            50,
        )
        .await
        .unwrap();
        assert_eq!(combined.total, 2);
        let play = &combined.rows[0];
        assert_eq!((play.kind.as_str(), play.id), ("session", session_id));
        assert!(play.scrobble_id.is_some());
        assert_eq!(play.queue_source_type.as_deref(), Some("album"));
        assert_eq!(combined.rows[1].kind, "scrobble");
        assert_eq!(combined.rows[1].song_id, "song-2");
    }
}
