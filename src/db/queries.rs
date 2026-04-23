// Some query functions are defined for completeness and future use
#![allow(dead_code)]

use crate::db::entity;
use crate::db::models::*;
use crate::db::ordering::case_insensitive_order;
use crate::db::Database;
use sea_orm::sea_query::{Expr, SimpleExpr};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, RelationTrait, TransactionTrait,
};
use uuid::Uuid;

// ============================================================================
// Song Query Constants
// ============================================================================
// These constants eliminate duplication across the many song query functions.
// All song queries filter out songs marked for deletion (recycle bin).

/// Base song query with artist and album joins (for simple lookups)
/// Filters out songs in the recycle bin (marked_for_deletion_at IS NOT NULL)
pub const SONG_BASE_QUERY: &str = r#"
    SELECT s.*, ar.name as artist_name, al.name as album_name
    FROM songs s
    INNER JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.marked_for_deletion_at IS NULL
"#;

/// Song query with scrobble statistics (play count, last played)
/// Filters out songs in the recycle bin (marked_for_deletion_at IS NOT NULL)
pub const SONG_BASE_QUERY_WITH_SCROBBLES: &str = r#"
    SELECT s.*, ar.name as artist_name, al.name as album_name,
           pc.play_count, pc.last_played, NULL as starred_at
    FROM songs s
    INNER JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
    WHERE s.marked_for_deletion_at IS NULL
"#;

/// Standalone scrobble statistics JOIN clause for composing with custom queries.
/// Use this when building dynamic queries that need play count and last played info.
/// Expects the songs table to be aliased as `s`.
/// NOTE: This aggregates across ALL users. For per-user stats, use `scrobble_stats_join_for_user()`.
pub const SCROBBLE_STATS_JOIN: &str = r#"
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
"#;

/// Scrobble statistics JOIN clause scoped to a specific user.
/// Returns a SQL fragment with one `?` placeholder for the `user_id` bind parameter.
/// Expects the songs table to be aliased as `s`.
pub fn scrobble_stats_join_for_user() -> &'static str {
    r#"
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
"#
}

/// Standard WHERE clause for filtering out songs marked for deletion.
/// Use this in custom queries that don't use SONG_BASE_QUERY constants.
pub const SONG_NOT_DELETED_FILTER: &str = "s.marked_for_deletion_at IS NULL";

// ============================================================================
// User queries
// ============================================================================

// Artist queries
// Playlist queries

/// Get all playlists visible to a user (their own + public playlists)
pub async fn get_playlists_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<Playlist>> {
    use entity::playlists::Column as P;
    use sea_orm::Condition;
    let name_order =
        case_insensitive_order(database.sea_backend(), (entity::playlists::Entity, P::Name));
    Ok(entity::playlists::Entity::find()
        .filter(
            Condition::any()
                .add(P::OwnerId.eq(user_id))
                .add(P::IsPublic.eq(true))
                .add(
                    P::Id.in_subquery(
                        entity::playlist_shares::Entity::find()
                            .select_only()
                            .column(entity::playlist_shares::Column::PlaylistId)
                            .filter(entity::playlist_shares::Column::SharedWithUserId.eq(user_id))
                            .into_query(),
                    ),
                ),
        )
        .order_by(name_order, sea_orm::Order::Asc)
        .into_model::<Playlist>()
        .all(database.conn())
        .await?)
}

/// Get a playlist by ID
pub async fn get_playlist_by_id(
    database: &Database,
    id: &str,
) -> crate::error::Result<Option<Playlist>> {
    Ok(entity::playlists::Entity::find_by_id(id.to_string())
        .into_model::<Playlist>()
        .one(database.conn())
        .await?)
}

/// Get songs in a playlist, ordered by position (includes play stats for sorting)
pub async fn get_playlist_songs(
    database: &Database,
    playlist_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    use crate::db::repo::scrobbles::{fetch_song_play_stats_rows, PlayStatsAggregation};
    use entity::playlist_songs::Column as PS;

    let mut songs: Vec<Song> = crate::db::repo::browse::song_select(database)
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::songs::Relation::PlaylistSongs.def(),
        )
        .filter(PS::PlaylistId.eq(playlist_id))
        .order_by(PS::Position, sea_orm::Order::Asc)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let stats = fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    crate::db::repo::browse::apply_song_play_stats(&mut songs, stats);
    Ok(songs)
}

/// Get songs in a playlist with their original positions (for queue materialization)
/// Returns tuples of (position, entry_id, song) where position is the original playlist position
/// and entry_id is the stable playlist entry identifier.
/// This is needed to correctly map start_index when playlists have missing entries,
/// and to track the original playlist entry for "now playing" indicators.
pub async fn get_playlist_songs_with_positions(
    database: &Database,
    playlist_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<(i64, String, Song)>> {
    use crate::db::repo::scrobbles::{fetch_song_play_stats_rows, PlayStatsAggregation};
    use entity::playlist_songs::Column as PS;

    #[derive(sea_orm::FromQueryResult)]
    struct PlaylistSongRow {
        #[sea_orm(nested)]
        song: Song,
        position: i64,
        playlist_entry_id: Option<String>,
    }

    let rows: Vec<PlaylistSongRow> = crate::db::repo::browse::song_select(database)
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::songs::Relation::PlaylistSongs.def(),
        )
        .column_as(PS::Position, "position")
        .column_as(PS::EntryId, "playlist_entry_id")
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(entity::songs::Column::Id.is_not_null())
        .order_by(PS::Position, sea_orm::Order::Asc)
        .into_model::<PlaylistSongRow>()
        .all(database.conn())
        .await?;

    let mut songs: Vec<Song> = rows.iter().map(|r| r.song.clone()).collect();
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let stats = fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::SumPlayCount,
    )
    .await?;
    crate::db::repo::browse::apply_song_play_stats(&mut songs, stats);

    Ok(rows
        .into_iter()
        .zip(songs)
        .map(|(r, s)| (r.position, r.playlist_entry_id.unwrap_or_default(), s))
        .collect())
}

/// Get unique album IDs from the first N songs in a playlist (for cover art)
pub async fn get_playlist_album_ids(
    database: &Database,
    playlist_id: &str,
    limit: i32,
) -> crate::error::Result<Vec<String>> {
    use entity::playlist_songs::Column as PS;

    let rows: Vec<(Option<String>,)> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::AlbumId)
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::playlist_songs::Relation::Songs.def(),
        )
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(entity::songs::Column::AlbumId.is_not_null())
        .order_by(PS::Position, sea_orm::Order::Asc)
        .into_tuple()
        .all(database.conn())
        .await?;

    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for (album_id,) in rows {
        if let Some(id) = album_id {
            if seen.insert(id.clone()) {
                result.push(id);
                if result.len() >= limit as usize {
                    break;
                }
            }
        }
    }
    Ok(result)
}

/// Create a new playlist
pub async fn create_playlist(
    database: &Database,
    id: &str,
    name: &str,
    owner_id: i64,
    comment: Option<&str>,
    is_public: bool,
    folder_id: Option<&str>,
) -> crate::error::Result<()> {
    let now = chrono::Utc::now().fixed_offset();
    let active = entity::playlists::ActiveModel {
        id: Set(id.to_string()),
        name: Set(name.to_string()),
        comment: Set(comment.map(|s| s.to_string())),
        owner_id: Set(owner_id),
        is_public: Set(is_public),
        folder_id: Set(folder_id.map(|s| s.to_string())),
        song_count: Set(0),
        duration: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        position: Set(0),
        last_played_at: Set(None),
    };
    active.insert(database.conn()).await?;
    Ok(())
}

/// Update playlist metadata
pub async fn update_playlist_metadata(
    database: &Database,
    id: &str,
    name: Option<&str>,
    comment: Option<&str>,
    is_public: Option<bool>,
) -> crate::error::Result<()> {
    use entity::playlists::Column as P;
    let mut q = entity::playlists::Entity::update_many()
        .col_expr(P::UpdatedAt, Expr::current_timestamp().into())
        .filter(P::Id.eq(id));
    if let Some(n) = name {
        q = q.col_expr(P::Name, Expr::value(n.to_string()));
    }
    if let Some(c) = comment {
        q = q.col_expr(P::Comment, Expr::value(c.to_string()));
    }
    if let Some(p) = is_public {
        q = q.col_expr(P::IsPublic, Expr::value(p));
    }
    q.exec(database.conn()).await?;
    Ok(())
}

/// Add songs to end of playlist
pub async fn add_songs_to_playlist(
    database: &Database,
    playlist_id: &str,
    song_ids: &[String],
) -> crate::error::Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    use entity::playlist_songs::Column as PS;
    let max_pos: i64 = entity::playlist_songs::Entity::find()
        .select_only()
        .expr_as(Expr::col(PS::Position).max().cast_as("BIGINT"), "max_pos")
        .filter(PS::PlaylistId.eq(playlist_id))
        .into_tuple::<Option<i64>>()
        .one(database.conn())
        .await?
        .flatten()
        .unwrap_or(-1);

    let mut position = max_pos + 1;
    let now = chrono::Utc::now().fixed_offset();
    for song_id in song_ids {
        let active = entity::playlist_songs::ActiveModel {
            playlist_id: Set(playlist_id.to_string()),
            song_id: Set(Some(song_id.clone())),
            position: Set(position),
            added_at: Set(now),
            entry_id: Set(Some(Uuid::new_v4().to_string())),
            missing_entry_data: Set(None),
            missing_search_text: Set(None),
        };
        active.insert(database.conn()).await?;
        position += 1;
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Playlist entry that can be either a matched song or a missing entry
pub struct PlaylistEntry {
    pub song_id: Option<String>,
    pub missing_entry_data: Option<MissingEntryData>,
    /// Denormalized search text for filtering missing entries
    pub missing_search_text: Option<String>,
}

/// Add entries to end of playlist (supports both matched songs and missing entries)
pub async fn add_entries_to_playlist(
    database: &Database,
    playlist_id: &str,
    entries: &[PlaylistEntry],
) -> crate::error::Result<()> {
    if entries.is_empty() {
        return Ok(());
    }

    use entity::playlist_songs::Column as PS;
    let max_pos: i64 = entity::playlist_songs::Entity::find()
        .select_only()
        .expr_as(Expr::col(PS::Position).max().cast_as("BIGINT"), "max_pos")
        .filter(PS::PlaylistId.eq(playlist_id))
        .into_tuple::<Option<i64>>()
        .one(database.conn())
        .await?
        .flatten()
        .unwrap_or(-1);

    let mut position = max_pos + 1;
    let now = chrono::Utc::now().fixed_offset();
    for entry in entries {
        let missing_json = entry
            .missing_entry_data
            .as_ref()
            .map(|data| serde_json::to_string(data).unwrap_or_default());
        let active = entity::playlist_songs::ActiveModel {
            playlist_id: Set(playlist_id.to_string()),
            song_id: Set(entry.song_id.clone()),
            position: Set(position),
            missing_entry_data: Set(missing_json),
            missing_search_text: Set(entry.missing_search_text.clone()),
            added_at: Set(now),
            entry_id: Set(Some(Uuid::new_v4().to_string())),
        };
        active.insert(database.conn()).await?;
        position += 1;
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Get all playlist entries including missing entries
pub async fn get_playlist_entries(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<Vec<PlaylistSong>> {
    use entity::playlist_songs::Column as PS;
    Ok(entity::playlist_songs::Entity::find()
        .select_only()
        .columns([
            PS::PlaylistId,
            PS::SongId,
            PS::Position,
            PS::MissingEntryData,
            PS::EntryId,
        ])
        .filter(PS::PlaylistId.eq(playlist_id))
        .order_by_asc(PS::Position)
        .into_model::<PlaylistSong>()
        .all(database.conn())
        .await?)
}

/// Update a missing entry to link it to a matched song
pub async fn match_missing_entry(
    database: &Database,
    playlist_id: &str,
    position: i32,
    song_id: &str,
) -> crate::error::Result<()> {
    use entity::playlist_songs::Column as PS;
    entity::playlist_songs::Entity::update_many()
        .col_expr(PS::SongId, Expr::value(song_id.to_string()))
        .col_expr(PS::MissingSearchText, Expr::value(Option::<String>::None))
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::Position.eq(position as i64))
        .exec(database.conn())
        .await?;
    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Unmatch a previously matched entry - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry(
    database: &Database,
    playlist_id: &str,
    position: i32,
) -> crate::error::Result<()> {
    use crate::db::models::MissingEntryData;
    use entity::playlist_songs::Column as PS;

    let missing_json: Option<String> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(PS::MissingEntryData)
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::Position.eq(position as i64))
        .into_tuple::<Option<String>>()
        .one(database.conn())
        .await?
        .flatten();

    let search_text = missing_json
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| build_missing_search_text(&data));

    entity::playlist_songs::Entity::update_many()
        .col_expr(PS::SongId, Expr::value(Option::<String>::None))
        .col_expr(PS::MissingSearchText, Expr::value(search_text))
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::Position.eq(position as i64))
        .exec(database.conn())
        .await?;
    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

fn build_missing_search_text(data: &MissingEntryData) -> String {
    let mut parts = Vec::new();
    if let Some(a) = &data.artist {
        if !a.is_empty() {
            parts.push(a.as_str());
        }
    }
    if let Some(a) = &data.album {
        if !a.is_empty() {
            parts.push(a.as_str());
        }
    }
    if let Some(t) = &data.title {
        if !t.is_empty() {
            parts.push(t.as_str());
        }
    }
    if parts.is_empty() {
        data.raw.clone()
    } else {
        parts.join(" - ")
    }
}

/// Update a missing entry to link it to a matched song, using entry_id for identification
pub async fn match_missing_entry_by_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
    song_id: &str,
) -> crate::error::Result<bool> {
    use entity::playlist_songs::Column as PS;
    let result = entity::playlist_songs::Entity::update_many()
        .col_expr(PS::SongId, Expr::value(song_id.to_string()))
        .col_expr(PS::MissingSearchText, Expr::value(Option::<String>::None))
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::EntryId.eq(entry_id))
        .exec(database.conn())
        .await?;

    if result.rows_affected == 0 {
        return Ok(false);
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(true)
}

/// Batch match multiple missing entries to songs
/// Returns the number of successfully matched entries
pub async fn batch_match_entries(
    database: &Database,
    playlist_id: &str,
    matches: &[(String, String)], // Vec of (entry_id, song_id)
) -> crate::error::Result<usize> {
    if matches.is_empty() {
        return Ok(0);
    }

    use entity::playlist_songs::Column as PS;
    let mut success_count = 0;
    for (entry_id, song_id) in matches {
        let result = entity::playlist_songs::Entity::update_many()
            .col_expr(PS::SongId, Expr::value(song_id.clone()))
            .col_expr(PS::MissingSearchText, Expr::value(Option::<String>::None))
            .filter(PS::PlaylistId.eq(playlist_id))
            .filter(PS::EntryId.eq(entry_id.clone()))
            .exec(database.conn())
            .await?;
        if result.rows_affected > 0 {
            success_count += 1;
        }
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(success_count)
}

/// Unmatch a previously matched entry by entry_id - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry_by_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
) -> crate::error::Result<bool> {
    use crate::db::models::MissingEntryData;
    use entity::playlist_songs::Column as PS;

    let missing_json: Option<Option<String>> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(PS::MissingEntryData)
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::EntryId.eq(entry_id))
        .into_tuple::<Option<String>>()
        .one(database.conn())
        .await?;

    let Some(missing_json) = missing_json else {
        return Ok(false);
    };

    let search_text = missing_json
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| build_missing_search_text(&data));

    entity::playlist_songs::Entity::update_many()
        .col_expr(PS::SongId, Expr::value(Option::<String>::None))
        .col_expr(PS::MissingSearchText, Expr::value(search_text))
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::EntryId.eq(entry_id))
        .exec(database.conn())
        .await?;

    update_playlist_totals(database, playlist_id).await?;
    Ok(true)
}

/// Remove songs from playlist by position indices
pub async fn remove_songs_by_position(
    database: &Database,
    playlist_id: &str,
    positions: &[u32],
) -> crate::error::Result<()> {
    if positions.is_empty() {
        return Ok(());
    }

    use entity::playlist_songs::Column as PS;
    let positions_i64: Vec<i64> = positions.iter().map(|p| *p as i64).collect();
    entity::playlist_songs::Entity::delete_many()
        .filter(PS::PlaylistId.eq(playlist_id))
        .filter(PS::Position.is_in(positions_i64))
        .exec(database.conn())
        .await?;

    reindex_playlist_positions(database, playlist_id).await?;
    update_playlist_totals(database, playlist_id).await?;

    Ok(())
}

/// Reindex playlist positions to be sequential (0, 1, 2, ...)
async fn reindex_playlist_positions(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<()> {
    use entity::playlist_songs::Column as PS;
    let positions: Vec<i64> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(PS::Position)
        .filter(PS::PlaylistId.eq(playlist_id))
        .order_by_asc(PS::Position)
        .into_tuple()
        .all(database.conn())
        .await?;

    for (new_pos, old_pos) in positions.iter().enumerate() {
        if new_pos as i64 != *old_pos {
            entity::playlist_songs::Entity::update_many()
                .col_expr(PS::Position, Expr::value(new_pos as i64))
                .filter(PS::PlaylistId.eq(playlist_id))
                .filter(PS::Position.eq(*old_pos))
                .exec(database.conn())
                .await?;
        }
    }

    Ok(())
}

/// Update playlist song_count and duration from its songs
async fn update_playlist_totals(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<()> {
    use entity::playlist_songs::Column as PS;
    use entity::playlists::Column as P;

    let song_count: i64 = entity::playlist_songs::Entity::find()
        .filter(PS::PlaylistId.eq(playlist_id))
        .count(database.conn())
        .await? as i64;

    let duration: Option<i64> = entity::playlist_songs::Entity::find()
        .select_only()
        .expr_as(
            Expr::col(entity::songs::Column::Duration)
                .sum()
                .cast_as("BIGINT"),
            "total",
        )
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::playlist_songs::Relation::Songs.def(),
        )
        .filter(PS::PlaylistId.eq(playlist_id))
        .into_tuple::<Option<i64>>()
        .one(database.conn())
        .await?
        .flatten();

    entity::playlists::Entity::update_many()
        .col_expr(P::SongCount, Expr::value(song_count))
        .col_expr(P::Duration, Expr::value(duration.unwrap_or(0)))
        .col_expr(P::UpdatedAt, Expr::current_timestamp().into())
        .filter(P::Id.eq(playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Delete a playlist (cascade deletes playlist_songs)
pub async fn delete_playlist(database: &Database, id: &str) -> crate::error::Result<()> {
    entity::playlists::Entity::delete_by_id(id.to_string())
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Delete a song from the database
///
/// This function:
/// - Converts playlist entries referencing this song to "missing" entries (preserves metadata)
/// - Deletes scrobbles for the song (CASCADE)
/// - Deletes starred entries for the song
/// - Cleans up FTS entries via trigger
/// - Updates album song_count
/// - Updates affected playlist totals
///
/// Playlist entries are NOT deleted - they become "missing" entries with the song's
/// metadata preserved, allowing them to be re-matched if the song is added again later.
pub async fn delete_song(database: &Database, id: &str) -> crate::error::Result<bool> {
    use entity::playlist_songs::Column as PS;
    use entity::playlists::Column as PL;
    use entity::songs::Column as S;
    use entity::starred::Column as ST;

    #[derive(sea_orm::FromQueryResult)]
    struct SongMeta {
        title: String,
        artist_name: Option<String>,
        album_name: Option<String>,
        duration: i64,
    }

    let meta: Option<SongMeta> = entity::songs::Entity::find()
        .select_only()
        .column(S::Title)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column_as(entity::albums::Column::Name, "album_name")
        .column(S::Duration)
        .join(
            sea_orm::JoinType::LeftJoin,
            entity::songs::Relation::Artists.def(),
        )
        .join(
            sea_orm::JoinType::LeftJoin,
            entity::songs::Relation::Albums.def(),
        )
        .filter(S::Id.eq(id))
        .into_model::<SongMeta>()
        .one(database.conn())
        .await?;

    let Some(SongMeta {
        title,
        artist_name,
        album_name,
        duration,
    }) = meta
    else {
        return Ok(false);
    };

    let album_id: Option<Option<String>> = entity::songs::Entity::find_by_id(id.to_string())
        .select_only()
        .column(S::AlbumId)
        .into_tuple()
        .one(database.conn())
        .await?;
    let album_id = album_id.flatten();

    let missing_data = serde_json::json!({
        "title": title,
        "artist": artist_name,
        "album": album_name,
        "duration": duration as i32,
        "raw": format!("{} - {}", artist_name.as_deref().unwrap_or("Unknown Artist"), title)
    });
    let missing_json = serde_json::to_string(&missing_data).unwrap_or_default();

    let mut parts = Vec::new();
    if let Some(ref a) = artist_name {
        parts.push(a.as_str());
    }
    if let Some(ref al) = album_name {
        parts.push(al.as_str());
    }
    parts.push(title.as_str());
    let search_text = parts.join(" - ");

    let tx = database.conn().begin().await?;

    let affected_playlist_ids: Vec<String> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(PS::PlaylistId)
        .distinct()
        .filter(PS::SongId.eq(id))
        .into_tuple()
        .all(&tx)
        .await?;

    entity::playlist_songs::Entity::update_many()
        .col_expr(PS::SongId, Expr::value(sea_orm::Value::String(None)))
        .col_expr(PS::MissingEntryData, Expr::value(missing_json))
        .col_expr(PS::MissingSearchText, Expr::value(search_text))
        .filter(PS::SongId.eq(id))
        .exec(&tx)
        .await?;

    entity::starred::Entity::delete_many()
        .filter(ST::ItemType.eq("song"))
        .filter(ST::ItemId.eq(id))
        .exec(&tx)
        .await?;

    let result = entity::songs::Entity::delete_by_id(id.to_string())
        .exec(&tx)
        .await?;

    if result.rows_affected == 0 {
        tx.rollback().await?;
        return Ok(false);
    }

    if let Some(album_id) = album_id {
        let song_count: i64 = entity::songs::Entity::find()
            .filter(S::AlbumId.eq(&album_id))
            .count(&tx)
            .await? as i64;
        let duration_sum: Option<i64> = entity::songs::Entity::find()
            .select_only()
            .expr_as(Expr::col(S::Duration).sum().cast_as("BIGINT"), "s")
            .filter(S::AlbumId.eq(&album_id))
            .into_tuple()
            .one(&tx)
            .await?
            .flatten();
        entity::albums::Entity::update_many()
            .col_expr(entity::albums::Column::SongCount, Expr::value(song_count))
            .col_expr(
                entity::albums::Column::Duration,
                Expr::value(duration_sum.unwrap_or(0)),
            )
            .filter(entity::albums::Column::Id.eq(&album_id))
            .exec(&tx)
            .await?;
    }

    for playlist_id in &affected_playlist_ids {
        let song_count: i64 = entity::playlist_songs::Entity::find()
            .filter(PS::PlaylistId.eq(playlist_id))
            .filter(PS::SongId.is_not_null())
            .count(&tx)
            .await? as i64;
        let duration_sum: Option<i64> = entity::playlist_songs::Entity::find()
            .select_only()
            .expr_as(
                Expr::col((entity::songs::Entity, S::Duration))
                    .sum()
                    .cast_as("BIGINT"),
                "s",
            )
            .join(
                sea_orm::JoinType::InnerJoin,
                entity::playlist_songs::Relation::Songs.def(),
            )
            .filter(PS::PlaylistId.eq(playlist_id))
            .into_tuple()
            .one(&tx)
            .await?
            .flatten();
        entity::playlists::Entity::update_many()
            .col_expr(PL::SongCount, Expr::value(song_count))
            .col_expr(PL::Duration, Expr::value(duration_sum.unwrap_or(0)))
            .col_expr(PL::UpdatedAt, Expr::current_timestamp().into())
            .filter(PL::Id.eq(playlist_id))
            .exec(&tx)
            .await?;
    }

    tx.commit().await?;
    Ok(true)
}

/// Update a song's file path in the database
pub async fn update_song_path(
    database: &Database,
    song_id: &str,
    new_path: &str,
) -> crate::error::Result<bool> {
    use entity::songs::Column as S;
    let result = entity::songs::Entity::update_many()
        .col_expr(S::FilePath, Expr::value(new_path.to_string()))
        .col_expr(S::UpdatedAt, Expr::current_timestamp().into())
        .filter(S::Id.eq(song_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update a song's file path and format in the database
/// Used when replacing audio with a different format
pub async fn update_song_path_and_format(
    database: &Database,
    song_id: &str,
    new_path: &str,
    new_format: &str,
) -> crate::error::Result<bool> {
    use entity::songs::Column as S;
    let result = entity::songs::Entity::update_many()
        .col_expr(S::FilePath, Expr::value(new_path.to_string()))
        .col_expr(S::FileFormat, Expr::value(new_format.to_string()))
        .col_expr(S::UpdatedAt, Expr::current_timestamp().into())
        .filter(S::Id.eq(song_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

// ============================================================================
// Playback Session queries
// ============================================================================

/// Get or create the single session for a user.
/// Returns the existing session if one exists, otherwise creates a new one.
pub async fn get_or_create_session(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<PlaybackSession> {
    if let Some(session) = entity::playback_sessions::Entity::find()
        .filter(entity::playback_sessions::Column::UserId.eq(user_id))
        .into_model::<PlaybackSession>()
        .one(database.conn())
        .await?
    {
        return Ok(session);
    }

    let id = Uuid::new_v4().to_string();
    let active = entity::playback_sessions::ActiveModel {
        id: Set(id.clone()),
        user_id: Set(user_id),
        name: Set(String::new()),
        client_name: Set("ferrotune-web".to_string()),
        is_playing: Set(false),
        current_song_id: Set(None),
        current_song_title: Set(None),
        current_song_artist: Set(None),
        last_heartbeat: Set(chrono::Utc::now().fixed_offset()),
        created_at: Set(chrono::Utc::now().fixed_offset()),
        owner_client_id: Set(None),
        owner_client_name: Set("ferrotune-web".to_string()),
        last_playing_at: Set(None),
    };
    active.insert(database.conn()).await?;

    let session = entity::playback_sessions::Entity::find_by_id(id)
        .into_model::<PlaybackSession>()
        .one(database.conn())
        .await?
        .ok_or_else(|| {
            crate::error::Error::Orm(sea_orm::DbErr::RecordNotFound(
                "playback_session insert missing".to_string(),
            ))
        })?;
    Ok(session)
}

/// Get a specific session by id (only if it belongs to the given user)
pub async fn get_session(
    database: &Database,
    session_id: &str,
    user_id: i64,
) -> crate::error::Result<Option<PlaybackSession>> {
    Ok(
        entity::playback_sessions::Entity::find_by_id(session_id.to_string())
            .filter(entity::playback_sessions::Column::UserId.eq(user_id))
            .into_model::<PlaybackSession>()
            .one(database.conn())
            .await?,
    )
}

/// Atomically update session heartbeat and queue position in a single transaction.
/// Ensures followers always see consistent session state + queue position.
///
/// Note: The queue's `current_index` + `position_ms` are the canonical position
/// source. The session table stores display metadata (song info) and liveness;
/// position data there is ephemeral.
#[allow(clippy::too_many_arguments)]
pub async fn update_session_heartbeat_with_position(
    database: &Database,
    session_id: &str,
    is_playing: bool,
    current_song_id: Option<&str>,
    current_song_title: Option<&str>,
    current_song_artist: Option<&str>,
    current_index: Option<i64>,
    position_ms: Option<i64>,
) -> crate::error::Result<bool> {
    use entity::playback_sessions::Column as S;
    let tx = database.conn().begin().await?;

    let last_playing_at_expr: SimpleExpr = if is_playing {
        Expr::current_timestamp().into()
    } else {
        Expr::col(S::LastPlayingAt).into()
    };

    let result = entity::playback_sessions::Entity::update_many()
        .col_expr(S::LastHeartbeat, Expr::current_timestamp().into())
        .col_expr(S::IsPlaying, Expr::value(is_playing))
        .col_expr(
            S::CurrentSongId,
            Expr::value(current_song_id.map(|s| s.to_string())),
        )
        .col_expr(
            S::CurrentSongTitle,
            Expr::value(current_song_title.map(|s| s.to_string())),
        )
        .col_expr(
            S::CurrentSongArtist,
            Expr::value(current_song_artist.map(|s| s.to_string())),
        )
        .col_expr(S::LastPlayingAt, last_playing_at_expr)
        .filter(S::Id.eq(session_id))
        .exec(&tx)
        .await?;

    if let (Some(idx), Some(pos)) = (current_index, position_ms) {
        use entity::play_queues::Column as Q;
        entity::play_queues::Entity::update_many()
            .col_expr(Q::CurrentIndex, Expr::value(idx))
            .col_expr(Q::PositionMs, Expr::value(pos))
            .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
            .filter(Q::SessionId.eq(session_id))
            .exec(&tx)
            .await?;
    }

    tx.commit().await?;
    Ok(result.rows_affected > 0)
}

/// Update only the heartbeat timestamp (for follower keepalive)
pub async fn update_session_heartbeat_timestamp(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    use entity::playback_sessions::Column as S;
    let result = entity::playback_sessions::Entity::update_many()
        .col_expr(S::LastHeartbeat, Expr::current_timestamp().into())
        .filter(S::Id.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update only last_playing_at (used to reset inactivity timeout on queue start).
pub async fn touch_session_last_playing_at(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    use entity::playback_sessions::Column as S;
    let result = entity::playback_sessions::Entity::update_many()
        .col_expr(S::LastPlayingAt, Expr::current_timestamp().into())
        .filter(S::Id.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update the owner of a session (on takeover)
pub async fn update_session_owner(
    database: &Database,
    session_id: &str,
    owner_client_id: Option<&str>,
    owner_client_name: &str,
) -> crate::error::Result<bool> {
    use entity::playback_sessions::Column as S;
    let result = entity::playback_sessions::Entity::update_many()
        .col_expr(
            S::OwnerClientId,
            Expr::value(owner_client_id.map(|s| s.to_string())),
        )
        .col_expr(
            S::OwnerClientName,
            Expr::value(owner_client_name.to_string()),
        )
        .col_expr(S::ClientName, Expr::value(owner_client_name.to_string()))
        .filter(S::Id.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Get the user's session (single session per user)
pub async fn get_user_session(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Option<PlaybackSession>> {
    Ok(entity::playback_sessions::Entity::find()
        .filter(entity::playback_sessions::Column::UserId.eq(user_id))
        .into_model::<PlaybackSession>()
        .one(database.conn())
        .await?)
}

/// Find sessions whose owner has been inactive (not playing) for at least the
/// given number of seconds. Returns the session IDs that should be disowned.
pub async fn get_sessions_with_inactive_owners(
    database: &Database,
    inactivity_seconds: i64,
) -> crate::error::Result<Vec<PlaybackSession>> {
    // Cutoff computed in Rust so we don't need dialect-specific date math.
    let cutoff = chrono::Utc::now() - chrono::Duration::seconds(inactivity_seconds);
    use entity::playback_sessions::Column as S;
    Ok(entity::playback_sessions::Entity::find()
        .filter(S::OwnerClientId.is_not_null())
        .filter(S::IsPlaying.eq(false))
        .filter(
            sea_orm::Condition::any()
                .add(S::LastPlayingAt.is_null())
                .add(S::LastPlayingAt.lt(cutoff)),
        )
        .into_model::<PlaybackSession>()
        .all(database.conn())
        .await?)
}

/// Clear ownership from a session (set owner_client_id to NULL).
pub async fn clear_session_owner(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    use entity::playback_sessions::Column as S;
    let result = entity::playback_sessions::Entity::update_many()
        .col_expr(S::OwnerClientId, Expr::value(Option::<String>::None))
        .filter(S::Id.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

// ============================================================================
// Play Queue queries (server-side queue management)
// ============================================================================

/// Get the play queue for a session, verifying it belongs to the given user
pub async fn get_play_queue_by_session(
    database: &Database,
    session_id: &str,
    user_id: i64,
) -> crate::error::Result<Option<PlayQueue>> {
    use entity::play_queues::Column as Q;
    Ok(entity::play_queues::Entity::find()
        .filter(Q::SessionId.eq(session_id))
        .filter(Q::UserId.eq(user_id))
        .into_model::<PlayQueue>()
        .one(database.conn())
        .await?)
}

/// Get queue length by session
pub async fn get_queue_length_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<i64> {
    use entity::play_queue_entries::Column as P;
    let count: i64 = entity::play_queue_entries::Entity::find()
        .select_only()
        .expr_as(P::SessionId.count(), "c")
        .filter(P::SessionId.eq(session_id))
        .into_tuple()
        .one(database.conn())
        .await?
        .unwrap_or(0);
    Ok(count)
}

fn queue_entry_with_song_select() -> sea_orm::Select<entity::play_queue_entries::Entity> {
    use entity::play_queue_entries::Column as P;
    entity::play_queue_entries::Entity::find()
        .select_only()
        .column(P::EntryId)
        .column(P::SourceEntryId)
        .column(P::QueuePosition)
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::play_queue_entries::Relation::Songs.def(),
        )
        .join(
            sea_orm::JoinType::InnerJoin,
            entity::songs::Relation::Artists.def(),
        )
        .join(
            sea_orm::JoinType::LeftJoin,
            entity::songs::Relation::Albums.def(),
        )
        .columns([
            entity::songs::Column::Id,
            entity::songs::Column::Title,
            entity::songs::Column::AlbumId,
            entity::songs::Column::ArtistId,
            entity::songs::Column::TrackNumber,
            entity::songs::Column::DiscNumber,
            entity::songs::Column::Year,
            entity::songs::Column::Genre,
            entity::songs::Column::Duration,
            entity::songs::Column::Bitrate,
            entity::songs::Column::FilePath,
            entity::songs::Column::FileSize,
            entity::songs::Column::FileFormat,
            entity::songs::Column::CreatedAt,
            entity::songs::Column::UpdatedAt,
            entity::songs::Column::CoverArtHash,
            entity::songs::Column::CoverArtWidth,
            entity::songs::Column::CoverArtHeight,
            entity::songs::Column::OriginalReplaygainTrackGain,
            entity::songs::Column::OriginalReplaygainTrackPeak,
            entity::songs::Column::ComputedReplaygainTrackGain,
            entity::songs::Column::ComputedReplaygainTrackPeak,
        ])
        .column_as(entity::artists::Column::Name, "artist_name")
        .column_as(entity::albums::Column::Name, "album_name")
}

/// Get queue entries with full song data by session
pub async fn get_queue_entries_with_songs_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    use entity::play_queue_entries::Column as P;
    Ok(queue_entry_with_song_select()
        .filter(P::SessionId.eq(session_id))
        .order_by_asc(P::QueuePosition)
        .into_model::<QueueEntryWithSong>()
        .all(database.conn())
        .await?)
}

/// Get queue entries at specific positions by session
pub async fn get_queue_entries_at_positions_by_session(
    database: &Database,
    session_id: &str,
    positions: &[usize],
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    if positions.is_empty() {
        return Ok(vec![]);
    }
    use entity::play_queue_entries::Column as P;
    let positions_i64: Vec<i64> = positions.iter().map(|p| *p as i64).collect();
    Ok(queue_entry_with_song_select()
        .filter(P::SessionId.eq(session_id))
        .filter(P::QueuePosition.is_in(positions_i64))
        .order_by_asc(P::QueuePosition)
        .into_model::<QueueEntryWithSong>()
        .all(database.conn())
        .await?)
}

/// Get queue entries in a contiguous range by session
pub async fn get_queue_entries_range_by_session(
    database: &Database,
    session_id: &str,
    offset: usize,
    limit: usize,
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    use entity::play_queue_entries::Column as P;
    Ok(queue_entry_with_song_select()
        .filter(P::SessionId.eq(session_id))
        .filter(P::QueuePosition.gte(offset as i64))
        .filter(P::QueuePosition.lt((offset + limit) as i64))
        .order_by_asc(P::QueuePosition)
        .into_model::<QueueEntryWithSong>()
        .all(database.conn())
        .await?)
}

/// Get all song IDs in queue order by session
pub async fn get_queue_song_ids_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<Vec<String>> {
    use entity::play_queue_entries::Column as P;
    let rows: Vec<String> = entity::play_queue_entries::Entity::find()
        .select_only()
        .column(P::SongId)
        .filter(P::SessionId.eq(session_id))
        .order_by_asc(P::QueuePosition)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows)
}

/// Create or replace the play queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_queue_for_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    source_type: &str,
    source_id: Option<&str>,
    source_name: Option<&str>,
    song_ids: &[String],
    source_entry_ids: Option<&[String]>,
    current_index: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    repeat_mode: &str,
    filters_json: Option<&str>,
    sort_json: Option<&str>,
    changed_by: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;
    let instance_id = Uuid::new_v4().to_string();

    entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;
    entity::play_queues::Entity::delete_many()
        .filter(entity::play_queues::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    const BATCH_SIZE: usize = 199;
    for chunk_start in (0..song_ids.len()).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(song_ids.len());
        let chunk = &song_ids[chunk_start..chunk_end];

        let models: Vec<entity::play_queue_entries::ActiveModel> = chunk
            .iter()
            .enumerate()
            .map(|(i, song_id)| {
                let position = chunk_start + i;
                let source_entry_id = source_entry_ids.and_then(|ids| ids.get(position)).cloned();
                entity::play_queue_entries::ActiveModel {
                    user_id: Set(user_id),
                    song_id: Set(song_id.clone()),
                    queue_position: Set(position as i64),
                    entry_id: Set(Uuid::new_v4().to_string()),
                    source_entry_id: Set(source_entry_id),
                    session_id: Set(session_id.to_string()),
                }
            })
            .collect();

        entity::play_queue_entries::Entity::insert_many(models)
            .exec(&tx)
            .await?;
    }

    let now = chrono::Utc::now().fixed_offset();
    let queue = entity::play_queues::ActiveModel {
        user_id: Set(user_id),
        session_id: Set(session_id.to_string()),
        source_type: Set(source_type.to_string()),
        source_id: Set(source_id.map(String::from)),
        source_name: Set(source_name.map(String::from)),
        current_index: Set(current_index),
        position_ms: Set(0),
        is_shuffled: Set(is_shuffled),
        shuffle_seed: Set(shuffle_seed),
        shuffle_indices_json: Set(shuffle_indices_json.map(String::from)),
        repeat_mode: Set(repeat_mode.to_string()),
        filters_json: Set(filters_json.map(String::from)),
        sort_json: Set(sort_json.map(String::from)),
        created_at: Set(now),
        updated_at: Set(now),
        changed_by: Set(changed_by.to_string()),
        total_count: Set(Some(song_ids.len() as i64)),
        is_lazy: Set(false),
        song_ids_json: Set(None),
        instance_id: Set(Some(instance_id)),
        version: Set(1),
        source_api: Set(String::new()),
    };
    queue.insert(&tx).await?;

    tx.commit().await?;
    Ok(())
}

/// Create a lazy queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_lazy_queue_for_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    source_type: &str,
    source_id: Option<&str>,
    source_name: Option<&str>,
    total_count: i64,
    current_index: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    repeat_mode: &str,
    filters_json: Option<&str>,
    sort_json: Option<&str>,
    song_ids_json: Option<&str>,
    changed_by: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;
    let instance_id = Uuid::new_v4().to_string();

    entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;
    entity::play_queues::Entity::delete_many()
        .filter(entity::play_queues::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    let now = chrono::Utc::now().fixed_offset();
    let queue = entity::play_queues::ActiveModel {
        user_id: Set(user_id),
        session_id: Set(session_id.to_string()),
        source_type: Set(source_type.to_string()),
        source_id: Set(source_id.map(String::from)),
        source_name: Set(source_name.map(String::from)),
        current_index: Set(current_index),
        position_ms: Set(0),
        is_shuffled: Set(is_shuffled),
        shuffle_seed: Set(shuffle_seed),
        shuffle_indices_json: Set(shuffle_indices_json.map(String::from)),
        repeat_mode: Set(repeat_mode.to_string()),
        filters_json: Set(filters_json.map(String::from)),
        sort_json: Set(sort_json.map(String::from)),
        created_at: Set(now),
        updated_at: Set(now),
        changed_by: Set(changed_by.to_string()),
        total_count: Set(Some(total_count)),
        is_lazy: Set(true),
        song_ids_json: Set(song_ids_json.map(String::from)),
        instance_id: Set(Some(instance_id)),
        version: Set(1),
        source_api: Set(String::new()),
    };
    queue.insert(&tx).await?;

    tx.commit().await?;
    Ok(())
}

/// Update queue position by session
pub async fn update_queue_position_by_session(
    database: &Database,
    session_id: &str,
    current_index: i64,
    position_ms: i64,
) -> crate::error::Result<bool> {
    use entity::play_queues::Column as Q;
    let result = entity::play_queues::Entity::update_many()
        .col_expr(Q::CurrentIndex, Expr::value(current_index))
        .col_expr(Q::PositionMs, Expr::value(position_ms))
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update only position_ms by session (without changing current_index)
pub async fn update_queue_position_ms_by_session(
    database: &Database,
    session_id: &str,
    position_ms: i64,
) -> crate::error::Result<bool> {
    use entity::play_queues::Column as Q;
    let result = entity::play_queues::Entity::update_many()
        .col_expr(Q::PositionMs, Expr::value(position_ms))
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update queue shuffle state by session
#[allow(clippy::too_many_arguments)]
pub async fn update_queue_shuffle_by_session(
    database: &Database,
    session_id: &str,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    current_index: i64,
    position_ms: i64,
    expected_version: Option<i64>,
) -> crate::error::Result<bool> {
    use entity::play_queues::Column as Q;
    let mut q = entity::play_queues::Entity::update_many()
        .col_expr(Q::IsShuffled, Expr::value(is_shuffled))
        .col_expr(Q::ShuffleSeed, Expr::value(shuffle_seed))
        .col_expr(
            Q::ShuffleIndicesJson,
            Expr::value(shuffle_indices_json.map(String::from)),
        )
        .col_expr(Q::CurrentIndex, Expr::value(current_index))
        .col_expr(Q::PositionMs, Expr::value(position_ms))
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .col_expr(Q::Version, Expr::col(Q::Version).add(1i64))
        .filter(Q::SessionId.eq(session_id));
    if let Some(ver) = expected_version {
        q = q.filter(Q::Version.eq(ver));
    }
    let result = q.exec(database.conn()).await?;
    Ok(result.rows_affected > 0)
}

/// Update song_ids_json on a queue (used to eagerly materialize lazy queues)
pub async fn update_queue_song_ids_by_session(
    database: &Database,
    session_id: &str,
    song_ids_json: Option<&str>,
) -> crate::error::Result<bool> {
    use entity::play_queues::Column as Q;
    let result = entity::play_queues::Entity::update_many()
        .col_expr(Q::SongIdsJson, Expr::value(song_ids_json.map(String::from)))
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Update queue repeat mode by session
pub async fn update_queue_repeat_mode_by_session(
    database: &Database,
    session_id: &str,
    repeat_mode: &str,
) -> crate::error::Result<bool> {
    use entity::play_queues::Column as Q;
    let result = entity::play_queues::Entity::update_many()
        .col_expr(Q::RepeatMode, Expr::value(repeat_mode.to_string()))
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Add songs to queue by session
pub async fn add_to_queue_by_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    song_ids: &[String],
    position: i64,
) -> crate::error::Result<i64> {
    if song_ids.is_empty() {
        return get_queue_length_by_session(database, session_id).await;
    }

    use entity::play_queue_entries::Column as PE;
    use entity::play_queues::Column as Q;

    let tx = database.conn().begin().await?;

    let queue_len: i64 = entity::play_queue_entries::Entity::find()
        .filter(PE::SessionId.eq(session_id))
        .count(&tx)
        .await? as i64;

    let insert_pos = if position < 0 { queue_len } else { position };

    if insert_pos < queue_len {
        let shift_amount = song_ids.len() as i64;
        // Two-phase shift to avoid UNIQUE(session_id, queue_position) violation:
        // move affected rows into a disjoint range first, then back.
        const TEMP_OFFSET: i64 = 1_000_000_000;
        entity::play_queue_entries::Entity::update_many()
            .col_expr(
                PE::QueuePosition,
                Expr::col(PE::QueuePosition).add(TEMP_OFFSET + shift_amount),
            )
            .filter(PE::SessionId.eq(session_id))
            .filter(PE::QueuePosition.gte(insert_pos))
            .exec(&tx)
            .await?;
        entity::play_queue_entries::Entity::update_many()
            .col_expr(
                PE::QueuePosition,
                Expr::col(PE::QueuePosition).sub(TEMP_OFFSET),
            )
            .filter(PE::SessionId.eq(session_id))
            .filter(PE::QueuePosition.gte(insert_pos + TEMP_OFFSET + shift_amount))
            .exec(&tx)
            .await?;
    }

    for (i, song_id) in song_ids.iter().enumerate() {
        let active = entity::play_queue_entries::ActiveModel {
            user_id: Set(user_id),
            song_id: Set(song_id.clone()),
            queue_position: Set(insert_pos + i as i64),
            entry_id: Set(Uuid::new_v4().to_string()),
            session_id: Set(session_id.to_string()),
            source_entry_id: Set(None),
        };
        active.insert(&tx).await?;
    }

    entity::play_queues::Entity::update_many()
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    tx.commit().await?;
    Ok(queue_len + song_ids.len() as i64)
}

/// Remove song from queue by session
pub async fn remove_from_queue_by_session(
    database: &Database,
    session_id: &str,
    position: i64,
) -> crate::error::Result<bool> {
    use entity::play_queue_entries::Column as PE;
    use entity::play_queues::Column as Q;

    let tx = database.conn().begin().await?;

    let result = entity::play_queue_entries::Entity::delete_many()
        .filter(PE::SessionId.eq(session_id))
        .filter(PE::QueuePosition.eq(position))
        .exec(&tx)
        .await?;

    if result.rows_affected == 0 {
        return Ok(false);
    }

    entity::play_queue_entries::Entity::update_many()
        .col_expr(PE::QueuePosition, Expr::col(PE::QueuePosition).sub(1i64))
        .filter(PE::SessionId.eq(session_id))
        .filter(PE::QueuePosition.gt(position))
        .exec(&tx)
        .await?;

    entity::play_queues::Entity::update_many()
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Move song in queue by session
pub async fn move_in_queue_by_session(
    database: &Database,
    session_id: &str,
    from_position: i64,
    to_position: i64,
) -> crate::error::Result<bool> {
    if from_position == to_position {
        return Ok(true);
    }

    use entity::play_queue_entries::Column as PE;
    use entity::play_queues::Column as Q;

    let tx = database.conn().begin().await?;

    let exists = entity::play_queue_entries::Entity::find()
        .filter(PE::SessionId.eq(session_id))
        .filter(PE::QueuePosition.eq(from_position))
        .count(&tx)
        .await?;

    if exists == 0 {
        return Ok(false);
    }

    let temp_position = -1i64;

    entity::play_queue_entries::Entity::update_many()
        .col_expr(PE::QueuePosition, Expr::value(temp_position))
        .filter(PE::SessionId.eq(session_id))
        .filter(PE::QueuePosition.eq(from_position))
        .exec(&tx)
        .await?;

    if from_position < to_position {
        entity::play_queue_entries::Entity::update_many()
            .col_expr(PE::QueuePosition, Expr::col(PE::QueuePosition).sub(1i64))
            .filter(PE::SessionId.eq(session_id))
            .filter(PE::QueuePosition.gt(from_position))
            .filter(PE::QueuePosition.lte(to_position))
            .exec(&tx)
            .await?;
    } else {
        // Two-phase shift to avoid UNIQUE constraint violation on SQLite.
        const TEMP_OFFSET: i64 = 1_000_000_000;
        entity::play_queue_entries::Entity::update_many()
            .col_expr(
                PE::QueuePosition,
                Expr::col(PE::QueuePosition).add(TEMP_OFFSET + 1),
            )
            .filter(PE::SessionId.eq(session_id))
            .filter(PE::QueuePosition.gte(to_position))
            .filter(PE::QueuePosition.lt(from_position))
            .exec(&tx)
            .await?;
        entity::play_queue_entries::Entity::update_many()
            .col_expr(
                PE::QueuePosition,
                Expr::col(PE::QueuePosition).sub(TEMP_OFFSET),
            )
            .filter(PE::SessionId.eq(session_id))
            .filter(PE::QueuePosition.gte(to_position + TEMP_OFFSET + 1))
            .filter(PE::QueuePosition.lt(from_position + TEMP_OFFSET + 1))
            .exec(&tx)
            .await?;
    }

    entity::play_queue_entries::Entity::update_many()
        .col_expr(PE::QueuePosition, Expr::value(to_position))
        .filter(PE::SessionId.eq(session_id))
        .filter(PE::QueuePosition.eq(temp_position))
        .exec(&tx)
        .await?;

    entity::play_queues::Entity::update_many()
        .col_expr(Q::UpdatedAt, Expr::current_timestamp().into())
        .filter(Q::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Clear queue by session
pub async fn clear_queue_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;

    entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;
    entity::play_queues::Entity::delete_many()
        .filter(entity::play_queues::Column::SessionId.eq(session_id))
        .exec(&tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_disabled_song_ids_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<String>> {
    use entity::disabled_songs::Column as D;
    Ok(entity::disabled_songs::Entity::find()
        .select_only()
        .column(D::SongId)
        .filter(D::UserId.eq(user_id))
        .order_by_asc(D::SongId)
        .into_tuple::<String>()
        .all(database.conn())
        .await?)
}

pub async fn get_shuffle_excluded_song_ids_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<String>> {
    use entity::shuffle_excludes::Column as S;
    Ok(entity::shuffle_excludes::Entity::find()
        .select_only()
        .column(S::SongId)
        .filter(S::UserId.eq(user_id))
        .order_by_asc(S::SongId)
        .into_tuple::<String>()
        .all(database.conn())
        .await?)
}

// ============================================================================
// Queue source materialization helpers
// ============================================================================

/// Get starred songs for a user (includes play stats for sorting)
pub async fn get_starred_songs(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    use crate::db::repo::scrobbles::{fetch_song_play_stats_rows, PlayStatsAggregation};

    let starred =
        crate::db::repo::starring::list_starred_accessible_songs(database, user_id).await?;
    if starred.is_empty() {
        return Ok(Vec::new());
    }

    let song_ids: Vec<String> = starred.iter().map(|(id, _)| id.clone()).collect();

    let mut songs: Vec<Song> = crate::db::repo::browse::song_select(database)
        .filter(entity::songs::Column::Id.is_in(song_ids.clone()))
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let stats = fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    crate::db::repo::browse::apply_song_play_stats(&mut songs, stats);

    // Populate starred_at and order by starred_at DESC (matching original query)
    let order_by_id: std::collections::HashMap<String, (usize, chrono::DateTime<chrono::Utc>)> =
        starred
            .iter()
            .enumerate()
            .map(|(i, (id, ts))| (id.clone(), (i, *ts)))
            .collect();
    for song in &mut songs {
        if let Some((_, ts)) = order_by_id.get(&song.id) {
            song.starred_at = Some(*ts);
        }
    }
    songs.sort_by_key(|s| {
        order_by_id
            .get(&s.id)
            .map(|(i, _)| *i)
            .unwrap_or(usize::MAX)
    });
    Ok(songs)
}

/// Get songs recursively under a directory path (includes play stats for sorting)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
/// Also supports legacy format for Subsonic compatibility: "dir-<encoded_path>"
pub async fn get_songs_by_directory(
    database: &Database,
    source_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    let (library_id, path_prefix) = parse_directory_source_id(source_id);
    directory_songs(database, user_id, library_id, path_prefix.as_deref(), false).await
}

/// Get songs in a directory without recursing into subdirectories
/// Only returns songs whose file_path matches "parentPath/filename" (no additional slashes)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
pub async fn get_songs_by_directory_flat(
    database: &Database,
    source_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            let path_prefix = if relative_path.is_empty() {
                None
            } else {
                Some(format!("{}/", relative_path.trim_end_matches('/')))
            };
            return directory_songs(
                database,
                user_id,
                Some(library_id),
                path_prefix.as_deref(),
                true,
            )
            .await;
        }
    }
    Ok(Vec::new())
}

fn parse_directory_source_id(source_id: &str) -> (Option<i64>, Option<String>) {
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            let path_prefix = if relative_path.is_empty() {
                None
            } else {
                Some(format!("{}/", relative_path.trim_end_matches('/')))
            };
            return (Some(library_id), path_prefix);
        }
    }

    let actual_path = source_id
        .strip_prefix("dir-")
        .map(|p| urlencoding::decode(p).unwrap_or_default().into_owned())
        .unwrap_or_else(|| source_id.to_string());

    let path_prefix = if actual_path.is_empty() {
        None
    } else {
        Some(format!("{}/", actual_path.trim_end_matches('/')))
    };
    (None, path_prefix)
}

async fn directory_songs(
    database: &Database,
    user_id: i64,
    library_id: Option<i64>,
    path_prefix: Option<&str>,
    flat: bool,
) -> crate::error::Result<Vec<Song>> {
    use crate::db::ordering::case_insensitive_order;
    use crate::db::repo::scrobbles::{fetch_song_play_stats_rows, PlayStatsAggregation};
    use entity::songs::Column as S;

    let mut q = crate::db::repo::browse::song_select(database);
    if let Some(lib_id) = library_id {
        q = q.filter(S::MusicFolderId.eq(lib_id));
    }
    if let Some(prefix) = path_prefix {
        let pattern = format!("{}%", prefix);
        q = q.filter(S::FilePath.like(pattern));
        if flat {
            let nested = format!("{}%/%", prefix);
            q = q.filter(S::FilePath.not_like(nested));
        }
    } else if flat {
        q = q.filter(S::FilePath.not_like("%/%"));
    }

    let order_expr =
        case_insensitive_order(database.sea_backend(), (entity::songs::Entity, S::FilePath));
    let mut songs: Vec<Song> = q
        .order_by(order_expr, sea_orm::Order::Asc)
        .into_model::<Song>()
        .all(database.conn())
        .await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let stats = fetch_song_play_stats_rows(
        database,
        Some(user_id),
        &song_ids,
        PlayStatsAggregation::CountRows,
    )
    .await?;
    crate::db::repo::browse::apply_song_play_stats(&mut songs, stats);
    Ok(songs)
}

// ============================================================================
// Playlist Folder Helpers
// ============================================================================

/// Parses a path string like "Folder1/Folder2/Playlist Name" and:
/// 1. Creates any missing folders in the hierarchy
/// 2. Returns (folder_id, playlist_name) where folder_id is the deepest folder
///
/// If the path has no slashes, returns (None, full_path) for root placement.
pub async fn resolve_or_create_folder_path(
    database: &Database,
    path: &str,
    owner_id: i64,
) -> crate::error::Result<(Option<String>, String)> {
    if !path.contains('/') {
        return Ok((None, path.to_string()));
    }

    let parts: Vec<&str> = path.split('/').collect();
    if parts.is_empty() {
        return Ok((None, path.to_string()));
    }

    let playlist_name = parts.last().unwrap().to_string();
    let folder_parts = &parts[..parts.len() - 1];

    if folder_parts.is_empty() {
        return Ok((None, playlist_name));
    }

    let mut parent_id: Option<String> = None;

    for folder_name in folder_parts {
        if folder_name.is_empty() {
            continue;
        }

        use entity::playlist_folders::Column as PF;
        let mut existing_q = entity::playlist_folders::Entity::find()
            .select_only()
            .column(PF::Id)
            .filter(PF::OwnerId.eq(owner_id))
            .filter(PF::Name.eq(*folder_name));
        existing_q = if let Some(ref pid) = parent_id {
            existing_q.filter(PF::ParentId.eq(pid.clone()))
        } else {
            existing_q.filter(PF::ParentId.is_null())
        };
        let existing: Option<String> = existing_q.into_tuple().one(database.conn()).await?;

        let folder_id = if let Some(id) = existing {
            id
        } else {
            let new_id = format!("pf-{}", Uuid::new_v4());

            let mut max_q = entity::playlist_folders::Entity::find()
                .select_only()
                .expr_as(Expr::col(PF::Position).max().cast_as("BIGINT"), "max_pos")
                .filter(PF::OwnerId.eq(owner_id));
            max_q = if let Some(ref pid) = parent_id {
                max_q.filter(PF::ParentId.eq(pid.clone()))
            } else {
                max_q.filter(PF::ParentId.is_null())
            };
            let max_pos: Option<i64> = max_q.into_tuple().one(database.conn()).await?.flatten();

            let active = entity::playlist_folders::ActiveModel {
                id: Set(new_id.clone()),
                name: Set(folder_name.to_string()),
                parent_id: Set(parent_id.clone()),
                owner_id: Set(owner_id),
                position: Set(max_pos.unwrap_or(-1) + 1),
                created_at: Set(chrono::Utc::now().fixed_offset()),
                cover_art: Set(None),
            };
            active.insert(database.conn()).await?;

            new_id
        };

        parent_id = Some(folder_id);
    }

    Ok((parent_id, playlist_name))
}

/// Get the full folder path for a given folder_id by walking up the parent hierarchy.
/// Returns the path segments joined by '/' (e.g., "Folder1/Folder2").
/// Returns None if folder_id is None.
pub async fn get_folder_path(
    database: &Database,
    folder_id: Option<&str>,
) -> crate::error::Result<Option<String>> {
    let Some(folder_id) = folder_id else {
        return Ok(None);
    };

    let mut path_segments: Vec<String> = Vec::new();
    let mut current_id = Some(folder_id.to_string());

    while let Some(id) = current_id.clone() {
        use entity::playlist_folders::Column as PF;
        let folder: Option<(String, Option<String>)> = entity::playlist_folders::Entity::find()
            .select_only()
            .column(PF::Name)
            .column(PF::ParentId)
            .filter(PF::Id.eq(id))
            .into_tuple()
            .one(database.conn())
            .await?;

        match folder {
            Some((name, parent_id)) => {
                path_segments.push(name);
                current_id = parent_id;
            }
            None => {
                current_id = None;
            }
        }
    }

    if path_segments.is_empty() {
        return Ok(None);
    }

    path_segments.reverse();
    Ok(Some(path_segments.join("/")))
}

/// Builds the full playlist name including folder path prefix.
/// Returns "Folder1/Folder2/PlaylistName" if in a folder, or just "PlaylistName" if at root.
pub async fn get_playlist_full_name(
    database: &Database,
    name: &str,
    folder_id: Option<&str>,
) -> crate::error::Result<String> {
    match get_folder_path(database, folder_id).await? {
        Some(path) => Ok(format!("{}/{}", path, name)),
        None => Ok(name.to_string()),
    }
}

/// Delete orphaned queues — queues whose session has no matching playback_sessions
/// row and that haven't been updated in `older_than_days` days.
/// Skips subsonic save/restore queues (playqueue-*) as those are stateless.
pub async fn cleanup_orphaned_queues(
    database: &Database,
    older_than_days: i64,
) -> crate::error::Result<u64> {
    use entity::play_queues::Column as Q;
    let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days);

    // Find the session_ids to clean up first
    let orphaned_sessions: Vec<String> = entity::play_queues::Entity::find()
        .select_only()
        .column(Q::SessionId)
        .filter(Q::SessionId.is_not_null())
        .filter(Q::SessionId.not_like("playqueue-%"))
        .filter(Q::UpdatedAt.lt(cutoff))
        .filter(
            Q::SessionId.not_in_subquery(
                entity::playback_sessions::Entity::find()
                    .select_only()
                    .column(entity::playback_sessions::Column::Id)
                    .into_query(),
            ),
        )
        .into_tuple::<Option<String>>()
        .all(database.conn())
        .await?
        .into_iter()
        .flatten()
        .collect();

    if orphaned_sessions.is_empty() {
        return Ok(0);
    }

    let entries_deleted = entity::play_queue_entries::Entity::delete_many()
        .filter(entity::play_queue_entries::Column::SessionId.is_in(orphaned_sessions.clone()))
        .exec(database.conn())
        .await?;

    let queues_deleted = entity::play_queues::Entity::delete_many()
        .filter(Q::SessionId.is_in(orphaned_sessions))
        .exec(database.conn())
        .await?;

    Ok(entries_deleted.rows_affected + queues_deleted.rows_affected)
}
