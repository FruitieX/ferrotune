//! Song likes: a repeatable, timestamped "still love this one" on top of
//! favorites. Each like is a row. A tap within `LIKE_UNDO_WINDOW` of the
//! song's newest like undoes that like instead of adding another, so tapping
//! repeatedly never piles up likes.

use std::collections::HashMap;

use chrono::{DateTime, TimeDelta, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue::Set, FromQueryResult, QueryOrder, QuerySelect};

use crate::db::entity;
use crate::db::models::{ItemType, Song, SongWithLibraryStatus};
use crate::db::Database;
use crate::error::Result;

/// How long a like can be undone by tapping again. Clients show a song as
/// "liked just now" (the next tap undoes) for this long after its newest like.
pub const LIKE_UNDO_WINDOW: TimeDelta = TimeDelta::hours(12);

#[derive(Debug, Clone, FromQueryResult)]
pub struct SongLikeStats {
    pub song_id: String,
    pub like_count: i64,
    pub last_liked: Option<DateTime<Utc>>,
}

/// The outcome of a like tap.
#[derive(Debug, Clone)]
pub struct SongLikeToggle {
    /// True when the tap added a like, false when it undid the newest one.
    pub liked: bool,
    pub like_count: i64,
    pub last_liked: Option<DateTime<Utc>>,
    /// The song's favorite timestamp after the tap: liking a song that isn't
    /// a favorite favorites it, and undoing that like unfavorites it again.
    pub starred_at: Option<DateTime<Utc>>,
}

/// Adds a like to `song_id`, or undoes the newest one when it is less than
/// `LIKE_UNDO_WINDOW` old.
pub async fn toggle_song_like(
    database: &Database,
    user_id: i64,
    song_id: &str,
    now: DateTime<Utc>,
) -> Result<SongLikeToggle> {
    let newest = entity::song_likes::Entity::find()
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .filter(entity::song_likes::Column::SongId.eq(song_id))
        .order_by_desc(entity::song_likes::Column::LikedAt)
        .order_by_desc(entity::song_likes::Column::Id)
        .one(database.conn())
        .await?;
    let is_starred = song_starred_at(database, user_id, song_id).await?.is_some();
    let song_ids = [song_id.to_string()];

    let liked = match newest {
        Some(like) if now.signed_duration_since(like.liked_at) < LIKE_UNDO_WINDOW => {
            entity::song_likes::Entity::delete_by_id(like.id)
                .exec(database.conn())
                .await?;
            if like.starred_song && is_starred {
                crate::db::repo::starring::unstar_items(database, user_id, &song_ids, &[], &[])
                    .await?;
            }
            false
        }
        _ => {
            if !is_starred {
                crate::db::repo::starring::star_items(database, user_id, &song_ids, &[], &[])
                    .await?;
            }
            entity::song_likes::ActiveModel {
                user_id: Set(user_id),
                song_id: Set(song_id.to_string()),
                liked_at: Set(now.fixed_offset()),
                starred_song: Set(!is_starred),
                ..Default::default()
            }
            .insert(database.conn())
            .await?;
            true
        }
    };

    let stats = fetch_song_like_stats(database, user_id, &song_ids)
        .await?
        .into_iter()
        .next();
    Ok(SongLikeToggle {
        liked,
        like_count: stats.as_ref().map_or(0, |stats| stats.like_count),
        last_liked: stats.and_then(|stats| stats.last_liked),
        starred_at: song_starred_at(database, user_id, song_id).await?,
    })
}

async fn song_starred_at(
    database: &Database,
    user_id: i64,
    song_id: &str,
) -> Result<Option<DateTime<Utc>>> {
    Ok(entity::starred::Entity::find()
        .filter(entity::starred::Column::UserId.eq(user_id))
        .filter(entity::starred::Column::ItemType.eq(ItemType::Song.as_str()))
        .filter(entity::starred::Column::ItemId.eq(song_id))
        .one(database.conn())
        .await?
        .map(|row| row.starred_at.with_timezone(&Utc)))
}

/// Like count and newest like per song, for the songs `user_id` has liked.
pub async fn fetch_song_like_stats(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<Vec<SongLikeStats>> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(like_stats_select()
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .filter(entity::song_likes::Column::SongId.is_in(song_ids.iter().cloned()))
        .group_by(entity::song_likes::Column::SongId)
        .into_model::<SongLikeStats>()
        .all(database.conn())
        .await?)
}

/// `fetch_song_like_stats` keyed by song id.
pub async fn song_like_map(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<HashMap<String, SongLikeStats>> {
    Ok(fetch_song_like_stats(database, user_id, song_ids)
        .await?
        .into_iter()
        .map(|stats| (stats.song_id.clone(), stats))
        .collect())
}

/// Fills `like_count` and `last_liked` on `songs` for `user_id`.
pub async fn attach_song_likes(
    database: &Database,
    user_id: i64,
    songs: &mut [Song],
) -> Result<()> {
    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let likes = song_like_map(database, user_id, &song_ids).await?;
    for song in songs {
        let stats = likes.get(&song.id);
        song.like_count = stats.map(|stats| stats.like_count);
        song.last_liked = stats.and_then(|stats| stats.last_liked);
    }
    Ok(())
}

/// `attach_song_likes` for songs listed with their library status.
pub async fn attach_library_song_likes(
    database: &Database,
    user_id: i64,
    songs: &mut [SongWithLibraryStatus],
) -> Result<()> {
    let song_ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();
    let likes = song_like_map(database, user_id, &song_ids).await?;
    for song in songs {
        let stats = likes.get(&song.id);
        song.like_count = stats.map(|stats| stats.like_count);
        song.last_liked = stats.and_then(|stats| stats.last_liked);
    }
    Ok(())
}

/// Number of distinct songs `user_id` has liked.
pub async fn count_liked_songs(database: &Database, user_id: i64) -> Result<i64> {
    Ok(entity::song_likes::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::song_likes::Column::SongId)
                .count_distinct()
                .cast_as("BIGINT"),
            "count",
        )
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .into_tuple::<Option<i64>>()
        .one(database.conn())
        .await?
        .flatten()
        .unwrap_or(0))
}

/// The user's liked songs, most likes first (newest like breaks ties).
pub async fn list_most_liked(
    database: &Database,
    user_id: i64,
    limit: i64,
    offset: i64,
) -> Result<Vec<SongLikeStats>> {
    Ok(like_stats_select()
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .group_by(entity::song_likes::Column::SongId)
        .order_by_desc(Expr::cust("like_count"))
        .order_by_desc(Expr::cust("last_liked"))
        .limit(limit.max(0) as u64)
        .offset(offset.max(0) as u64)
        .into_model::<SongLikeStats>()
        .all(database.conn())
        .await?)
}

/// Likes given in `[start, end)`.
pub async fn count_likes_between(
    database: &Database,
    user_id: i64,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<i64> {
    Ok(entity::song_likes::Entity::find()
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .filter(entity::song_likes::Column::LikedAt.gte(start.fixed_offset()))
        .filter(entity::song_likes::Column::LikedAt.lt(end.fixed_offset()))
        .count(database.conn())
        .await? as i64)
}

/// The songs liked most in `[start, end)`, counting only likes in that period.
pub async fn top_liked_between(
    database: &Database,
    user_id: i64,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<SongLikeStats>> {
    Ok(like_stats_select()
        .filter(entity::song_likes::Column::UserId.eq(user_id))
        .filter(entity::song_likes::Column::LikedAt.gte(start.fixed_offset()))
        .filter(entity::song_likes::Column::LikedAt.lt(end.fixed_offset()))
        .group_by(entity::song_likes::Column::SongId)
        .order_by_desc(Expr::cust("like_count"))
        .order_by_desc(Expr::cust("last_liked"))
        .limit(limit.max(0) as u64)
        .into_model::<SongLikeStats>()
        .all(database.conn())
        .await?)
}

fn like_stats_select() -> sea_orm::Select<entity::song_likes::Entity> {
    entity::song_likes::Entity::find()
        .select_only()
        .column(entity::song_likes::Column::SongId)
        .column_as(
            Expr::col(entity::song_likes::Column::Id)
                .count()
                .cast_as("BIGINT"),
            "like_count",
        )
        .column_as(
            Expr::col(entity::song_likes::Column::LikedAt).max(),
            "last_liked",
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use sea_orm::ActiveValue;

    async fn setup_database() -> Database {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("create sqlite memory db");
        entity::users::ActiveModel {
            id: ActiveValue::Set(1),
            username: ActiveValue::Set("likes-test".to_string()),
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
                title: ActiveValue::Set(format!("Title {song_id}")),
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
    async fn a_second_tap_within_the_window_undoes_the_like() {
        let database = setup_database().await;
        let monday = Utc.with_ymd_and_hms(2026, 10, 12, 20, 0, 0).unwrap();

        let first = toggle_song_like(&database, 1, "song-1", monday)
            .await
            .unwrap();
        assert!(first.liked);
        assert_eq!(first.like_count, 1);
        assert_eq!(first.last_liked, Some(monday));
        // Liking a song that isn't a favorite favorites it...
        assert!(first.starred_at.is_some());

        // ...and undoing that like within the window unfavorites it again.
        let undo = toggle_song_like(&database, 1, "song-1", monday + TimeDelta::hours(2))
            .await
            .unwrap();
        assert!(!undo.liked);
        assert_eq!(undo.like_count, 0);
        assert_eq!(undo.last_liked, None);
        assert_eq!(undo.starred_at, None);

        // Tapping on toggles rather than piling up likes.
        let again = toggle_song_like(&database, 1, "song-1", monday + TimeDelta::hours(3))
            .await
            .unwrap();
        assert!(again.liked);
        assert_eq!(again.like_count, 1);
    }

    #[tokio::test]
    async fn likes_add_up_across_days_and_keep_existing_favorites() {
        let database = setup_database().await;
        let start = Utc.with_ymd_and_hms(2026, 10, 1, 21, 0, 0).unwrap();
        crate::db::repo::starring::star_items(&database, 1, &["song-2".to_string()], &[], &[])
            .await
            .unwrap();

        for day in 0..3 {
            let tap = toggle_song_like(&database, 1, "song-2", start + TimeDelta::days(day))
                .await
                .unwrap();
            assert!(tap.liked);
        }
        // The next evening is past the window: a new like, not an undo.
        let fourth = toggle_song_like(
            &database,
            1,
            "song-2",
            start + TimeDelta::days(3) + LIKE_UNDO_WINDOW,
        )
        .await
        .unwrap();
        assert!(fourth.liked);
        assert_eq!(fourth.like_count, 4);

        // Undoing a like on a song that was already a favorite keeps it one.
        let undo = toggle_song_like(
            &database,
            1,
            "song-2",
            start + TimeDelta::days(3) + LIKE_UNDO_WINDOW + TimeDelta::minutes(5),
        )
        .await
        .unwrap();
        assert!(!undo.liked);
        assert_eq!(undo.like_count, 3);
        assert_eq!(undo.last_liked, Some(start + TimeDelta::days(2)));
        assert!(undo.starred_at.is_some());

        toggle_song_like(&database, 1, "song-1", start)
            .await
            .unwrap();
        let most_liked = list_most_liked(&database, 1, 10, 0).await.unwrap();
        assert_eq!(
            most_liked
                .iter()
                .map(|row| (row.song_id.as_str(), row.like_count))
                .collect::<Vec<_>>(),
            vec![("song-2", 3), ("song-1", 1)]
        );
        assert_eq!(count_liked_songs(&database, 1).await.unwrap(), 2);

        // Period counts only include likes given in the period.
        let first_two_days = (start, start + TimeDelta::days(2));
        assert_eq!(
            count_likes_between(&database, 1, first_two_days.0, first_two_days.1)
                .await
                .unwrap(),
            3
        );
        let top = top_liked_between(&database, 1, first_two_days.0, first_two_days.1, 10)
            .await
            .unwrap();
        assert_eq!(top[0].song_id, "song-2");
        assert_eq!(top[0].like_count, 2);
    }
}
