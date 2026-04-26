//! Play history query helpers.

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, JoinType, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait,
};

use crate::db::entity;
use crate::db::models::Song;
use crate::error::Result;

/// Aggregated "most recent scrobble per song" row, ordered by last_played DESC.
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct SongPlayAggregate {
    pub song_id: String,
    pub play_count: i64,
    pub last_played: Option<DateTime<Utc>>,
}

/// Fetch the top N most-recently scrobbled songs for a user, paginated.
pub async fn list_recent_song_aggregates<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<SongPlayAggregate>> {
    use entity::scrobbles::Column as S;
    let rows = entity::scrobbles::Entity::find()
        .select_only()
        .column(S::SongId)
        .expr_as(S::Id.count(), "play_count")
        .expr_as(S::PlayedAt.max(), "last_played")
        .filter(S::Submission.eq(true))
        .filter(S::UserId.eq(user_id))
        .filter(S::PlayedAt.is_not_null())
        .group_by(S::SongId)
        .order_by_desc(sea_orm::sea_query::Expr::col(
            sea_orm::sea_query::Alias::new("last_played"),
        ))
        .limit(size as u64)
        .offset(offset as u64)
        .into_model::<SongPlayAggregate>()
        .all(conn)
        .await?;
    Ok(rows)
}

/// Count distinct songs the user has ever played (submission scrobbles).
pub async fn count_distinct_played_songs<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<i64> {
    use entity::scrobbles::Column as S;
    use sea_orm::sea_query::{Expr, Func};
    let value: Option<i64> = entity::scrobbles::Entity::find()
        .select_only()
        .expr(Func::count_distinct(Expr::col(S::SongId)))
        .filter(S::Submission.eq(true))
        .filter(S::UserId.eq(user_id))
        .filter(S::PlayedAt.is_not_null())
        .into_tuple::<i64>()
        .one(conn)
        .await?;
    Ok(value.unwrap_or(0))
}

/// Fetch `Song` rows (with `artist_name`/`album_name` joined) for the given
/// ids. `play_count`, `last_played`, and `starred_at` are returned as `None`
/// and the caller is expected to populate them.
pub async fn fetch_songs_by_ids<C: ConnectionTrait>(conn: &C, ids: &[String]) -> Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    use entity::songs::Column as S;
    use sea_orm::sea_query::Expr;
    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::Id)
        .column(S::Title)
        .column(S::AlbumId)
        .column_as(entity::albums::Column::Name, "album_name")
        .column(S::ArtistId)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column(S::TrackNumber)
        .column(S::DiscNumber)
        .column(S::Year)
        .column(S::Genre)
        .column(S::Duration)
        .column(S::Bitrate)
        .column(S::FilePath)
        .column(S::FileSize)
        .column(S::FileFormat)
        .column(S::CreatedAt)
        .column(S::UpdatedAt)
        .column(S::CoverArtHash)
        .column(S::CoverArtWidth)
        .column(S::CoverArtHeight)
        .column(S::OriginalReplaygainTrackGain)
        .column(S::OriginalReplaygainTrackPeak)
        .column(S::ComputedReplaygainTrackGain)
        .column(S::ComputedReplaygainTrackPeak)
        .expr_as(Expr::cust("NULL"), "play_count")
        .expr_as(Expr::cust("NULL"), "last_played")
        .expr_as(Expr::cust("NULL"), "starred_at")
        .join(JoinType::InnerJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(S::Id.is_in(ids.iter().cloned()))
        .into_model::<Song>()
        .all(conn)
        .await?;
    Ok(rows)
}
