//! SeaORM-backed list/reporting queries for the simpler album and song list surfaces.

use chrono::{DateTime, FixedOffset, Utc};
use sea_orm::sea_query::{CaseStatement, Expr, SimpleExpr};
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, FromQueryResult, JoinType, Order, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, RelationTrait,
};

use crate::db::entity;
use crate::db::models::{Album, ItemType};
use crate::db::ordering::case_insensitive_order;
use crate::db::repo::users;
use crate::db::Database;
use crate::error::Result;

fn album_select() -> sea_orm::Select<entity::albums::Entity> {
    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .column(entity::albums::Column::Name)
        .column(entity::albums::Column::ArtistId)
        .column(entity::albums::Column::Year)
        .column(entity::albums::Column::Genre)
        .column(entity::albums::Column::SongCount)
        .column(entity::albums::Column::Duration)
        .column(entity::albums::Column::CreatedAt)
        .column(entity::albums::Column::CoverArtHash)
        .column_as(entity::artists::Column::Name, "artist_name")
        .join(JoinType::InnerJoin, entity::albums::Relation::Artists.def())
}

async fn visible_album_ids_for_folder_ids(
    database: &Database,
    folder_ids: &[i64],
) -> Result<Vec<String>> {
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    let album_ids = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::AlbumId)
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied()))
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .distinct()
        .into_tuple::<Option<String>>()
        .all(database.conn())
        .await?;

    Ok(album_ids.into_iter().flatten().collect())
}

async fn visible_song_id_query(
    database: &Database,
    user_id: i64,
) -> Result<sea_orm::Select<entity::songs::Entity>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;

    Ok(entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids.iter().copied())))
}

pub async fn visible_album_ids_for_user(database: &Database, user_id: i64) -> Result<Vec<String>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    visible_album_ids_for_folder_ids(database, &folder_ids).await
}

pub async fn fetch_albums_by_ids_in_order(
    database: &Database,
    album_ids: &[String],
) -> Result<Vec<Album>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }

    let albums = album_select()
        .filter(entity::albums::Column::Id.is_in(album_ids.iter().cloned()))
        .into_model::<Album>()
        .all(database.conn())
        .await?;

    let order_map = album_ids
        .iter()
        .enumerate()
        .map(|(index, album_id)| (album_id.as_str(), index))
        .collect::<std::collections::HashMap<_, _>>();

    let mut ordered_albums = albums;
    ordered_albums.sort_by_key(|album| {
        order_map
            .get(album.id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
    });

    Ok(ordered_albums)
}

pub async fn count_visible_albums_for_user(
    database: &Database,
    user_id: i64,
    genre: Option<&str>,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> Result<i64> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(0);
    }

    let mut query =
        entity::albums::Entity::find().filter(entity::albums::Column::Id.is_in(visible_album_ids));

    if let Some(genre) = genre {
        query = query.filter(entity::albums::Column::Genre.eq(genre));
    }
    if let Some(from_year) = from_year {
        query = query.filter(entity::albums::Column::Year.gte(from_year));
    }
    if let Some(to_year) = to_year {
        query = query.filter(entity::albums::Column::Year.lte(to_year));
    }

    Ok(query.count(database.conn()).await? as i64)
}

pub async fn count_starred_albums_for_user(database: &Database, user_id: i64) -> Result<i64> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(0);
    }

    Ok(entity::starred::Entity::find()
        .filter(entity::starred::Column::UserId.eq(user_id))
        .filter(entity::starred::Column::ItemType.eq(ItemType::Album.as_str()))
        .filter(entity::starred::Column::ItemId.is_in(visible_album_ids))
        .count(database.conn())
        .await? as i64)
}

pub async fn list_album_ids_newest(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .filter(entity::albums::Column::Id.is_in(visible_album_ids))
        .order_by_desc(entity::albums::Column::CreatedAt)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_album_ids_alphabetical_by_name(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .filter(entity::albums::Column::Id.is_in(visible_album_ids))
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::albums::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::albums::Column::Name)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_album_ids_alphabetical_by_artist(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .join(JoinType::InnerJoin, entity::albums::Relation::Artists.def())
        .filter(entity::albums::Column::Id.is_in(visible_album_ids))
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::artists::Entity, entity::artists::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name)),
            Order::Asc,
        )
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::albums::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::albums::Column::Name)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_album_ids_by_year(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut query = entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .filter(entity::albums::Column::Id.is_in(visible_album_ids));

    if let Some(from_year) = from_year {
        query = query.filter(entity::albums::Column::Year.gte(from_year));
    }
    if let Some(to_year) = to_year {
        query = query.filter(entity::albums::Column::Year.lte(to_year));
    }

    query
        .order_by_desc(entity::albums::Column::Year)
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::albums::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::albums::Column::Name)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_album_ids_by_genre(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
    genre: &str,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .filter(entity::albums::Column::Id.is_in(visible_album_ids))
        .filter(entity::albums::Column::Genre.eq(genre))
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::albums::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::albums::Column::Name)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn list_starred_album_ids(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<String>> {
    let visible_album_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_album_ids.is_empty() {
        return Ok(Vec::new());
    }

    entity::starred::Entity::find()
        .select_only()
        .column(entity::starred::Column::ItemId)
        .filter(entity::starred::Column::UserId.eq(user_id))
        .filter(entity::starred::Column::ItemType.eq(ItemType::Album.as_str()))
        .filter(entity::starred::Column::ItemId.is_in(visible_album_ids))
        .order_by_desc(entity::starred::Column::StarredAt)
        .limit(size as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn visible_song_ids_for_user(
    database: &Database,
    user_id: i64,
    genre: Option<&str>,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> Result<Vec<String>> {
    let mut query = visible_song_id_query(database, user_id).await?;

    if let Some(genre) = genre {
        query = query.filter(entity::songs::Column::Genre.eq(genre));
    }
    if let Some(from_year) = from_year {
        query = query.filter(entity::songs::Column::Year.gte(from_year));
    }
    if let Some(to_year) = to_year {
        query = query.filter(entity::songs::Column::Year.lte(to_year));
    }

    query
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn song_ids_by_genre_for_user(
    database: &Database,
    user_id: i64,
    genre: &str,
    count: i64,
    offset: i64,
) -> Result<Vec<String>> {
    visible_song_id_query(database, user_id)
        .await?
        .filter(entity::songs::Column::Genre.eq(genre))
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::songs::Column::Title),
            Order::Asc,
        )
        .order_by_asc(entity::songs::Column::Title)
        .limit(count as u64)
        .offset(offset as u64)
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

// =========================================================================
// Phase 4: Frequent / Recent album lists, forgotten favorites,
// continue-listening source resolution and playlist batch lookups.
// =========================================================================

/// `(album_id, last_played)` pair for the Recent album list.
#[derive(Debug, Clone)]
pub struct RecentAlbum {
    pub album_id: String,
    pub last_played: DateTime<Utc>,
}

/// `(source_type, source_id, last_played)` row for the continue-listening feed.
#[derive(Debug, Clone)]
pub struct ContinueListeningSource {
    pub source_type: String,
    pub source_id: String,
    pub last_played: DateTime<Utc>,
}

/// Minimal playlist info (id, name, song_count, duration) used by the
/// continue-listening batch lookup.
#[derive(Debug, Clone)]
pub struct PlaylistSummary {
    pub id: String,
    pub name: String,
    pub song_count: i64,
    pub duration: i64,
}

#[derive(Debug, Clone)]
pub struct NamedId {
    pub id: String,
    pub name: String,
}

/// Count scrobbles per album for the given user (and optional since cutoff),
/// then sort visible albums by scrobble count descending (0 if no scrobbles)
/// and paginate.
pub async fn list_frequent_album_ids(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
    since: Option<DateTime<Utc>>,
) -> Result<Vec<String>> {
    let visible_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_ids.is_empty() {
        return Ok(Vec::new());
    }

    #[derive(FromQueryResult)]
    struct AlbumCountRow {
        album_id: String,
        scrobble_count: i64,
    }

    let mut query = entity::scrobbles::Entity::find()
        .select_only()
        .column_as(entity::songs::Column::AlbumId, "album_id")
        .expr_as(
            Expr::col((entity::scrobbles::Entity, entity::scrobbles::Column::Id))
                .count()
                .cast_as("BIGINT"),
            "scrobble_count",
        )
        .join(
            JoinType::InnerJoin,
            entity::scrobbles::Relation::Songs.def(),
        )
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .group_by(entity::songs::Column::AlbumId);

    if let Some(since) = since {
        query = query.filter(entity::scrobbles::Column::PlayedAt.gte(since.fixed_offset()));
    }

    let counts = query
        .into_model::<AlbumCountRow>()
        .all(database.conn())
        .await?;

    let count_map: std::collections::HashMap<String, i64> = counts
        .into_iter()
        .map(|row| (row.album_id, row.scrobble_count))
        .collect();

    let mut ordered = visible_ids;
    ordered.sort_by_key(|id| std::cmp::Reverse(count_map.get(id).copied().unwrap_or(0)));

    let start = (offset as usize).min(ordered.len());
    let end = (start + size as usize).min(ordered.len());
    Ok(ordered[start..end].to_vec())
}

/// Aggregate scrobbles grouped by album id for albums visible to the user,
/// sort by most recent scrobble descending, and paginate. Only albums with at
/// least one scrobble are returned.
pub async fn list_recent_albums_for_user(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<RecentAlbum>> {
    let visible_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_ids.is_empty() {
        return Ok(Vec::new());
    }

    #[derive(FromQueryResult)]
    struct Row {
        album_id: String,
        last_played: Option<DateTime<FixedOffset>>,
    }

    let rows = entity::scrobbles::Entity::find()
        .select_only()
        .column_as(entity::songs::Column::AlbumId, "album_id")
        .expr_as(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::PlayedAt,
            ))
            .max(),
            "last_played",
        )
        .join(
            JoinType::InnerJoin,
            entity::scrobbles::Relation::Songs.def(),
        )
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::songs::Column::AlbumId.is_in(visible_ids))
        .group_by(entity::songs::Column::AlbumId)
        .into_model::<Row>()
        .all(database.conn())
        .await?;

    let mut rows: Vec<RecentAlbum> = rows
        .into_iter()
        .filter_map(|r| {
            r.last_played.map(|dt| RecentAlbum {
                album_id: r.album_id,
                last_played: dt.with_timezone(&Utc),
            })
        })
        .collect();

    rows.sort_by(|a, b| b.last_played.cmp(&a.last_played));

    let start = (offset as usize).min(rows.len());
    let end = (start + size as usize).min(rows.len());
    Ok(rows[start..end].to_vec())
}

/// Count distinct albums with at least one scrobble in the user's visible
/// library.
pub async fn count_recent_albums_for_user(database: &Database, user_id: i64) -> Result<i64> {
    let visible_ids = visible_album_ids_for_user(database, user_id).await?;
    if visible_ids.is_empty() {
        return Ok(0);
    }

    let result = entity::scrobbles::Entity::find()
        .select_only()
        .expr_as(
            Expr::col(entity::songs::Column::AlbumId)
                .count_distinct()
                .cast_as("BIGINT"),
            "count",
        )
        .join(
            JoinType::InnerJoin,
            entity::scrobbles::Relation::Songs.def(),
        )
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::songs::Column::AlbumId.is_in(visible_ids))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?
        .unwrap_or(0);

    Ok(result)
}

/// Find songs with high play counts that haven't been played recently.
///
/// Returns the full list of qualifying song ids (caller handles pagination /
/// random shuffling).
pub async fn list_forgotten_favorite_song_ids(
    database: &Database,
    user_id: i64,
    min_plays: i64,
    cutoff: DateTime<Utc>,
) -> Result<Vec<String>> {
    let folder_ids = users::get_enabled_accessible_music_folder_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(Vec::new());
    }

    #[derive(FromQueryResult)]
    struct Row {
        song_id: String,
        sum_plays: Option<i64>,
        max_played_at: Option<DateTime<FixedOffset>>,
    }

    let rows = entity::scrobbles::Entity::find()
        .select_only()
        .column(entity::scrobbles::Column::SongId)
        .expr_as(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::PlayCount,
            ))
            .sum()
            .cast_as("BIGINT"),
            "sum_plays",
        )
        .expr_as(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::PlayedAt,
            ))
            .max(),
            "max_played_at",
        )
        .join(
            JoinType::InnerJoin,
            entity::scrobbles::Relation::Songs.def(),
        )
        .filter(entity::scrobbles::Column::UserId.eq(user_id))
        .filter(entity::scrobbles::Column::Submission.eq(true))
        .filter(entity::songs::Column::MarkedForDeletionAt.is_null())
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids))
        .group_by(entity::scrobbles::Column::SongId)
        .into_model::<Row>()
        .all(database.conn())
        .await?;

    let cutoff_offset = cutoff.fixed_offset();
    Ok(rows
        .into_iter()
        .filter(|r| {
            r.sum_plays.unwrap_or(0) >= min_plays
                && r.max_played_at.is_none_or(|dt| dt < cutoff_offset)
        })
        .map(|r| r.song_id)
        .collect())
}

/// Build a sea_query expression evaluating to the continue-listening source
/// type/id for a scrobble row. Playlists / smart playlists / song-radio queue
/// sources keep their original id; everything else falls back to album.
fn continue_listening_case(
    then_column: entity::scrobbles::Column,
    else_expr: SimpleExpr,
) -> SimpleExpr {
    let special_types = ["playlist", "smartPlaylist", "songRadio"];
    let cond = Condition::all()
        .add(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::QueueSourceType,
            ))
            .is_in(special_types),
        )
        .add(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::QueueSourceId,
            ))
            .is_not_null(),
        );

    CaseStatement::new()
        .case(
            cond,
            SimpleExpr::from(Expr::col((entity::scrobbles::Entity, then_column))),
        )
        .finally(else_expr)
        .into()
}

/// Base select grouping scrobbles by the CASE-derived source key for the
/// continue-listening feed. We wrap the CASE projections in a derived table so
/// the outer `GROUP BY` references simple column aliases, which both SQLite
/// and Postgres accept.
fn continue_listening_subquery(user_id: i64) -> sea_orm::sea_query::SelectStatement {
    use sea_orm::sea_query::{Alias, Query as SqQuery};

    let source_type_expr = continue_listening_case(
        entity::scrobbles::Column::QueueSourceType,
        Expr::value("album"),
    );
    let source_id_expr = continue_listening_case(
        entity::scrobbles::Column::QueueSourceId,
        SimpleExpr::from(Expr::col((
            entity::songs::Entity,
            entity::songs::Column::AlbumId,
        ))),
    );

    let mut inner = SqQuery::select();
    inner
        .expr_as(source_type_expr, Alias::new("source_type"))
        .expr_as(source_id_expr, Alias::new("source_id"))
        .expr_as(
            Expr::col((
                entity::scrobbles::Entity,
                entity::scrobbles::Column::PlayedAt,
            )),
            Alias::new("played_at"),
        )
        .from(entity::scrobbles::Entity)
        .inner_join(
            entity::songs::Entity,
            Expr::col((entity::scrobbles::Entity, entity::scrobbles::Column::SongId))
                .equals((entity::songs::Entity, entity::songs::Column::Id)),
        )
        .inner_join(
            entity::music_folders::Entity,
            Expr::col((entity::songs::Entity, entity::songs::Column::MusicFolderId)).equals((
                entity::music_folders::Entity,
                entity::music_folders::Column::Id,
            )),
        )
        .inner_join(
            entity::user_library_access::Entity,
            Expr::col((
                entity::user_library_access::Entity,
                entity::user_library_access::Column::MusicFolderId,
            ))
            .equals((
                entity::music_folders::Entity,
                entity::music_folders::Column::Id,
            )),
        )
        .and_where(entity::scrobbles::Column::UserId.eq(user_id))
        .and_where(entity::music_folders::Column::Enabled.eq(true))
        .and_where(entity::user_library_access::Column::UserId.eq(user_id))
        .and_where(
            Expr::expr(
                Expr::col((
                    entity::scrobbles::Entity,
                    entity::scrobbles::Column::QueueSourceType,
                ))
                .if_null(""),
            )
            .is_not_in(["forgottenFavorites", "continueListening"]),
        );

    let mut outer = SqQuery::select();
    outer
        .expr(Expr::col(Alias::new("source_type")))
        .expr(Expr::col(Alias::new("source_id")))
        .expr_as(
            Expr::col(Alias::new("played_at")).max(),
            Alias::new("last_played"),
        )
        .from_subquery(inner, Alias::new("src"))
        .add_group_by([
            SimpleExpr::from(Expr::col(Alias::new("source_type"))),
            SimpleExpr::from(Expr::col(Alias::new("source_id"))),
        ]);
    outer
}

/// Fetch continue-listening source rows ordered by last played descending.
pub async fn list_continue_listening_sources(
    database: &Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> Result<Vec<ContinueListeningSource>> {
    use sea_orm::sea_query::{Alias, Order as SqOrder};
    use sea_orm::ConnectionTrait;

    #[derive(FromQueryResult)]
    struct Row {
        source_type: String,
        source_id: String,
        last_played: Option<DateTime<FixedOffset>>,
    }

    let mut stmt = continue_listening_subquery(user_id);
    stmt.order_by(Alias::new("last_played"), SqOrder::Desc)
        .limit(size as u64)
        .offset(offset as u64);

    let backend = database.conn().get_database_backend();
    let sql = backend.build(&stmt);
    let rows = Row::find_by_statement(sql).all(database.conn()).await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            row.last_played.map(|dt| ContinueListeningSource {
                source_type: row.source_type,
                source_id: row.source_id,
                last_played: dt.with_timezone(&Utc),
            })
        })
        .collect())
}

/// Count of distinct continue-listening sources for the user.
pub async fn count_continue_listening_sources(database: &Database, user_id: i64) -> Result<i64> {
    use sea_orm::ConnectionTrait;

    #[derive(FromQueryResult)]
    struct Row {
        source_type: String,
        source_id: String,
    }

    let stmt = continue_listening_subquery(user_id);
    let backend = database.conn().get_database_backend();
    let sql = backend.build(&stmt);
    let rows = Row::find_by_statement(sql).all(database.conn()).await?;
    Ok(rows.len() as i64)
}

/// Fetch the minimal playlist summary (id, name, song_count, total duration)
/// for each of the requested playlist ids.
pub async fn list_playlist_summaries(
    database: &Database,
    ids: &[String],
) -> Result<Vec<PlaylistSummary>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    #[derive(FromQueryResult)]
    struct Row {
        id: String,
        name: String,
        song_count: i64,
        duration: Option<i64>,
    }

    use sea_orm::sea_query::Query as SqQuery;
    let duration_subquery = SqQuery::select()
        .expr(
            Expr::col((entity::songs::Entity, entity::songs::Column::Duration))
                .sum()
                .cast_as("BIGINT"),
        )
        .from(entity::playlist_songs::Entity)
        .inner_join(
            entity::songs::Entity,
            Expr::col((entity::songs::Entity, entity::songs::Column::Id)).equals((
                entity::playlist_songs::Entity,
                entity::playlist_songs::Column::SongId,
            )),
        )
        .and_where(
            Expr::col((
                entity::playlist_songs::Entity,
                entity::playlist_songs::Column::PlaylistId,
            ))
            .equals((entity::playlists::Entity, entity::playlists::Column::Id)),
        )
        .to_owned();

    let rows = entity::playlists::Entity::find()
        .select_only()
        .column(entity::playlists::Column::Id)
        .column(entity::playlists::Column::Name)
        .column(entity::playlists::Column::SongCount)
        .expr_as(
            SimpleExpr::SubQuery(
                None,
                Box::new(sea_orm::sea_query::SubQueryStatement::SelectStatement(
                    duration_subquery,
                )),
            ),
            "duration",
        )
        .filter(entity::playlists::Column::Id.is_in(ids.iter().cloned()))
        .into_model::<Row>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| PlaylistSummary {
            id: r.id,
            name: r.name,
            song_count: r.song_count,
            duration: r.duration.unwrap_or(0),
        })
        .collect())
}

/// Fetch minimal (id, name) rows for the requested smart playlist ids.
pub async fn list_smart_playlist_named_ids(
    database: &Database,
    ids: &[String],
) -> Result<Vec<NamedId>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = entity::smart_playlists::Entity::find()
        .select_only()
        .column(entity::smart_playlists::Column::Id)
        .column(entity::smart_playlists::Column::Name)
        .filter(entity::smart_playlists::Column::Id.is_in(ids.iter().cloned()))
        .into_tuple::<(String, String)>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name)| NamedId { id, name })
        .collect())
}
