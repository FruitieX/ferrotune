use chrono::{DateTime, Duration, Utc};

pub const RECENT_SCROBBLE_DEDUP_WINDOW_SECS: i64 = 30;

pub async fn insert_submission_scrobble_if_not_recent_duplicate(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    song_id: &str,
    played_at: DateTime<Utc>,
    queue_source_type: Option<&str>,
    queue_source_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let duplicate_cutoff = played_at - Duration::seconds(RECENT_SCROBBLE_DEDUP_WINDOW_SECS);

    let result = sqlx::query(
        r#"
        INSERT INTO scrobbles (
            user_id,
            song_id,
            played_at,
            submission,
            queue_source_type,
            queue_source_id
        )
        SELECT ?, ?, ?, 1, ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM scrobbles
            WHERE user_id = ?
              AND song_id = ?
              AND submission = 1
              AND played_at > ?
        )
        "#,
    )
    .bind(user_id)
    .bind(song_id)
    .bind(played_at)
    .bind(queue_source_type)
    .bind(queue_source_id)
    .bind(user_id)
    .bind(song_id)
    .bind(duplicate_cutoff)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::insert_submission_scrobble_if_not_recent_duplicate;
    use chrono::{TimeZone, Utc};

    async fn setup_pool() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect(":memory:")
            .await
            .expect("create sqlite memory db");

        sqlx::query(
            r#"
            CREATE TABLE scrobbles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                song_id TEXT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                submission BOOLEAN NOT NULL DEFAULT 1,
                play_count INTEGER NOT NULL DEFAULT 1,
                description TEXT,
                queue_source_type TEXT,
                queue_source_id TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create scrobbles table");

        pool
    }

    #[tokio::test]
    async fn rejects_same_song_within_dedupe_window() {
        let pool = setup_pool().await;
        let first_play = Utc.with_ymd_and_hms(2026, 3, 25, 14, 53, 42).unwrap();

        let inserted = insert_submission_scrobble_if_not_recent_duplicate(
            &pool,
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
            &pool,
            1,
            "song-1",
            first_play + chrono::Duration::seconds(3),
            Some("album"),
            Some("album-1"),
        )
        .await
        .expect("check duplicate scrobble");
        assert!(!duplicate);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scrobbles")
            .fetch_one(&pool)
            .await
            .expect("count scrobbles");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn allows_new_scrobble_after_dedupe_window() {
        let pool = setup_pool().await;
        let first_play = Utc.with_ymd_and_hms(2026, 3, 25, 14, 53, 42).unwrap();

        insert_submission_scrobble_if_not_recent_duplicate(
            &pool, 1, "song-1", first_play, None, None,
        )
        .await
        .expect("insert first scrobble");

        let inserted = insert_submission_scrobble_if_not_recent_duplicate(
            &pool,
            1,
            "song-1",
            first_play + chrono::Duration::seconds(31),
            None,
            None,
        )
        .await
        .expect("insert later scrobble");

        assert!(inserted);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scrobbles")
            .fetch_one(&pool)
            .await
            .expect("count scrobbles");
        assert_eq!(count, 2);
    }
}
