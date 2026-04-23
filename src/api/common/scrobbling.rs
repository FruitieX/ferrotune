use chrono::{DateTime, Duration, Utc};
use sea_orm::sea_query::{Cond, Expr, Query};
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseBackend};

use crate::db::{entity, Database};

pub const RECENT_SCROBBLE_DEDUP_WINDOW_SECS: i64 = 30;

pub async fn insert_submission_scrobble_if_not_recent_duplicate(
    database: &Database,
    user_id: i64,
    song_id: &str,
    played_at: DateTime<Utc>,
    queue_source_type: Option<&str>,
    queue_source_id: Option<&str>,
) -> crate::error::Result<bool> {
    let duplicate_cutoff =
        (played_at - Duration::seconds(RECENT_SCROBBLE_DEDUP_WINDOW_SECS)).fixed_offset();
    let played_at_off = played_at.fixed_offset();
    let song_id_owned = song_id.to_string();

    // Subquery matching an existing submission scrobble for the same
    // user+song within the dedupe window.
    let dedupe_sub = Query::select()
        .expr(Expr::value(1))
        .from(entity::scrobbles::Entity)
        .and_where(entity::scrobbles::Column::UserId.eq(user_id))
        .and_where(entity::scrobbles::Column::SongId.eq(song_id_owned.clone()))
        .and_where(entity::scrobbles::Column::Submission.eq(true))
        .and_where(entity::scrobbles::Column::PlayedAt.gt(duplicate_cutoff))
        .to_owned();

    // SELECT that produces the new row only when no duplicate exists.
    let select = Query::select()
        .expr(Expr::value(user_id))
        .expr(Expr::value(song_id_owned))
        .expr(Expr::value(played_at_off))
        .expr(Expr::value(true))
        .expr(Expr::value(queue_source_type.map(String::from)))
        .expr(Expr::value(queue_source_id.map(String::from)))
        .cond_where(Cond::all().not().add(Expr::exists(dedupe_sub)))
        .to_owned();

    let mut insert = Query::insert();
    insert
        .into_table(entity::scrobbles::Entity)
        .columns([
            entity::scrobbles::Column::UserId,
            entity::scrobbles::Column::SongId,
            entity::scrobbles::Column::PlayedAt,
            entity::scrobbles::Column::Submission,
            entity::scrobbles::Column::QueueSourceType,
            entity::scrobbles::Column::QueueSourceId,
        ])
        .select_from(select)
        .map_err(|e| {
            crate::error::Error::Internal(format!("failed to build scrobble insert statement: {e}"))
        })?;

    let backend: DatabaseBackend = database.conn().get_database_backend();
    let stmt = backend.build(&insert);
    let result = database.conn().execute(stmt).await?;
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::insert_submission_scrobble_if_not_recent_duplicate;
    use crate::db::{entity, Database};
    use chrono::{TimeZone, Utc};
    use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, PaginatorTrait};

    async fn setup_database() -> Database {
        // Use an in-memory SQLite database initialized via the production
        // migrator so the schema exactly matches runtime.
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("create sqlite memory db");

        // Seed a user, artist, and song so the scrobbles FK constraints
        // are satisfied for tests.
        entity::users::ActiveModel {
            id: ActiveValue::Set(1),
            username: ActiveValue::Set("scrobble-test".to_string()),
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

        entity::songs::ActiveModel {
            id: ActiveValue::Set("song-1".to_string()),
            title: ActiveValue::Set("Test Song".to_string()),
            artist_id: ActiveValue::Set("artist-1".to_string()),
            file_path: ActiveValue::Set("/tmp/test.mp3".to_string()),
            file_size: ActiveValue::Set(0),
            file_format: ActiveValue::Set("mp3".to_string()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert song");

        database
    }

    async fn count_scrobbles(database: &Database) -> i64 {
        crate::db::entity::scrobbles::Entity::find()
            .count(database.conn())
            .await
            .expect("count scrobbles") as i64
    }

    #[tokio::test]
    async fn rejects_same_song_within_dedupe_window() {
        let database = setup_database().await;
        let first_play = Utc.with_ymd_and_hms(2026, 3, 25, 14, 53, 42).unwrap();

        let inserted = insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            1,
            "song-1",
            first_play,
            Some("album"),
            Some("album-1"),
        )
        .await
        .expect("insert first scrobble");
        assert!(inserted);

        let duplicate = insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            1,
            "song-1",
            first_play + chrono::Duration::seconds(3),
            Some("album"),
            Some("album-1"),
        )
        .await
        .expect("check duplicate scrobble");
        assert!(!duplicate);

        assert_eq!(count_scrobbles(&database).await, 1);
    }

    #[tokio::test]
    async fn allows_new_scrobble_after_dedupe_window() {
        let database = setup_database().await;
        let first_play = Utc.with_ymd_and_hms(2026, 3, 25, 14, 53, 42).unwrap();

        insert_submission_scrobble_if_not_recent_duplicate(
            &database, 1, "song-1", first_play, None, None,
        )
        .await
        .expect("insert first scrobble");

        let inserted = insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            1,
            "song-1",
            first_play + chrono::Duration::seconds(31),
            None,
            None,
        )
        .await
        .expect("insert later scrobble");

        assert!(inserted);

        assert_eq!(count_scrobbles(&database).await, 2);
    }
}
