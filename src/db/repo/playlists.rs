//! Playlist folder and sharing queries for the Ferrotune admin API easy slices.

use std::collections::HashMap;

use chrono::{DateTime, FixedOffset, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order,
    QueryFilter, QueryOrder, QuerySelect, RelationTrait, TransactionTrait,
};

use crate::db::entity;
use crate::db::ordering::case_insensitive_order;
use crate::db::Database;
use crate::error::Result;

#[derive(Debug, Clone)]
pub struct PlaylistFolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub created_at: DateTime<FixedOffset>,
    pub has_cover_art: bool,
}

#[derive(Debug, Clone)]
pub struct PlaylistListingRecord {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub position: i64,
    pub song_count: i64,
    pub duration: i64,
    pub owner_name: Option<String>,
    pub shared_with_me: bool,
    pub can_edit: bool,
    pub updated_at: DateTime<FixedOffset>,
}

#[derive(Debug, Clone)]
pub struct PlaylistShareRecord {
    pub user_id: i64,
    pub username: String,
    pub can_edit: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct PlaylistShareInput {
    pub user_id: i64,
    pub can_edit: bool,
}

#[derive(Debug, FromQueryResult)]
struct OptionalI64Row {
    value: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct PlaylistFolderQueryRow {
    id: String,
    name: String,
    parent_id: Option<String>,
    position: i64,
    created_at: DateTime<FixedOffset>,
    has_cover_art: bool,
}

#[derive(Debug, FromQueryResult)]
struct OwnedPlaylistQueryRow {
    id: String,
    name: String,
    folder_id: Option<String>,
    position: i64,
    song_count: i64,
    updated_at: DateTime<FixedOffset>,
}

#[derive(Debug, FromQueryResult)]
struct SharedPlaylistQueryRow {
    id: String,
    name: String,
    position: i64,
    song_count: i64,
    owner_name: String,
    can_edit: bool,
    updated_at: DateTime<FixedOffset>,
}

#[derive(Debug, FromQueryResult)]
struct PlaylistDurationQueryRow {
    playlist_id: String,
    duration: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct PlaylistOverrideQueryRow {
    playlist_id: String,
    folder_id: Option<String>,
}

#[derive(Debug, FromQueryResult)]
struct PlaylistShareQueryRow {
    user_id: i64,
    username: String,
    can_edit: bool,
}

fn playlist_folder_select(
    database: &Database,
) -> sea_orm::Select<entity::playlist_folders::Entity> {
    entity::playlist_folders::Entity::find()
        .select_only()
        .column(entity::playlist_folders::Column::Id)
        .column(entity::playlist_folders::Column::Name)
        .column(entity::playlist_folders::Column::ParentId)
        .column(entity::playlist_folders::Column::Position)
        .column(entity::playlist_folders::Column::CreatedAt)
        .column_as(
            Expr::col(entity::playlist_folders::Column::CoverArt).is_not_null(),
            "has_cover_art",
        )
        .order_by_asc(entity::playlist_folders::Column::Position)
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                entity::playlist_folders::Column::Name,
            ),
            Order::Asc,
        )
        .order_by_asc(entity::playlist_folders::Column::Name)
}

async fn fetch_playlist_duration_map(
    database: &Database,
    playlist_ids: &[String],
) -> Result<HashMap<String, i64>> {
    if playlist_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = entity::playlist_songs::Entity::find()
        .select_only()
        .column(entity::playlist_songs::Column::PlaylistId)
        .column_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::Duration))
                .sum()
                .cast_as("BIGINT"),
            "duration",
        )
        .join(
            JoinType::InnerJoin,
            entity::playlist_songs::Relation::Songs.def(),
        )
        .filter(entity::playlist_songs::Column::PlaylistId.is_in(playlist_ids.iter().cloned()))
        .group_by(entity::playlist_songs::Column::PlaylistId)
        .into_model::<PlaylistDurationQueryRow>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.playlist_id, row.duration.unwrap_or(0)))
        .collect())
}

async fn fetch_playlist_override_map(
    database: &Database,
    user_id: i64,
    playlist_ids: &[String],
) -> Result<HashMap<String, Option<String>>> {
    if playlist_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = entity::user_playlist_overrides::Entity::find()
        .select_only()
        .column(entity::user_playlist_overrides::Column::PlaylistId)
        .column(entity::user_playlist_overrides::Column::FolderId)
        .filter(entity::user_playlist_overrides::Column::UserId.eq(user_id))
        .filter(
            entity::user_playlist_overrides::Column::PlaylistId.is_in(playlist_ids.iter().cloned()),
        )
        .into_model::<PlaylistOverrideQueryRow>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.playlist_id, row.folder_id))
        .collect())
}

pub async fn playlist_folder_exists(
    database: &Database,
    folder_id: &str,
    user_id: i64,
) -> Result<bool> {
    Ok(
        entity::playlist_folders::Entity::find_by_id(folder_id.to_string())
            .filter(entity::playlist_folders::Column::OwnerId.eq(user_id))
            .select_only()
            .column(entity::playlist_folders::Column::Id)
            .into_tuple::<String>()
            .one(database.conn())
            .await?
            .is_some(),
    )
}

pub async fn next_playlist_folder_position(
    database: &Database,
    user_id: i64,
    parent_id: Option<&str>,
) -> Result<i64> {
    let mut query = entity::playlist_folders::Entity::find()
        .select_only()
        .column_as(
            Expr::col(entity::playlist_folders::Column::Position)
                .max()
                .cast_as("BIGINT"),
            "value",
        )
        .filter(entity::playlist_folders::Column::OwnerId.eq(user_id));

    query = match parent_id {
        Some(parent_id) => query.filter(entity::playlist_folders::Column::ParentId.eq(parent_id)),
        None => query.filter(entity::playlist_folders::Column::ParentId.is_null()),
    };

    Ok(query
        .into_model::<OptionalI64Row>()
        .one(database.conn())
        .await?
        .and_then(|row| row.value)
        .map_or(0, |value| value + 1))
}

pub async fn fetch_playlist_folder(
    database: &Database,
    folder_id: &str,
) -> Result<Option<PlaylistFolderRecord>> {
    Ok(playlist_folder_select(database)
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .into_model::<PlaylistFolderQueryRow>()
        .one(database.conn())
        .await?
        .map(|row| PlaylistFolderRecord {
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
            position: row.position,
            created_at: row.created_at,
            has_cover_art: row.has_cover_art,
        }))
}

pub async fn create_playlist_folder(
    database: &Database,
    id: &str,
    name: &str,
    parent_id: Option<&str>,
    owner_id: i64,
    position: i64,
) -> Result<()> {
    entity::playlist_folders::ActiveModel {
        id: Set(id.to_string()),
        name: Set(name.to_string()),
        parent_id: Set(parent_id.map(str::to_string)),
        owner_id: Set(owner_id),
        position: Set(position),
        created_at: Set(Utc::now().fixed_offset()),
        cover_art: Set(None),
    }
    .insert(database.conn())
    .await?;

    Ok(())
}

pub async fn update_playlist_folder_name(
    database: &Database,
    folder_id: &str,
    name: &str,
) -> Result<()> {
    entity::playlist_folders::Entity::update_many()
        .col_expr(
            entity::playlist_folders::Column::Name,
            Expr::value(name.to_string()),
        )
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn update_playlist_folder_parent(
    database: &Database,
    folder_id: &str,
    parent_id: Option<&str>,
) -> Result<()> {
    entity::playlist_folders::Entity::update_many()
        .col_expr(
            entity::playlist_folders::Column::ParentId,
            Expr::value(parent_id.map(str::to_string)),
        )
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn delete_playlist_folder(
    database: &Database,
    folder_id: &str,
    owner_id: i64,
) -> Result<bool> {
    let result = entity::playlist_folders::Entity::delete_many()
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .filter(entity::playlist_folders::Column::OwnerId.eq(owner_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn set_playlist_folder_cover(
    database: &Database,
    folder_id: &str,
    cover_art: Vec<u8>,
) -> Result<()> {
    entity::playlist_folders::Entity::update_many()
        .col_expr(
            entity::playlist_folders::Column::CoverArt,
            Expr::value(Some(cover_art)),
        )
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn clear_playlist_folder_cover(
    database: &Database,
    folder_id: &str,
    owner_id: i64,
) -> Result<bool> {
    let result = entity::playlist_folders::Entity::update_many()
        .col_expr(
            entity::playlist_folders::Column::CoverArt,
            Expr::value(Option::<Vec<u8>>::None),
        )
        .filter(entity::playlist_folders::Column::Id.eq(folder_id))
        .filter(entity::playlist_folders::Column::OwnerId.eq(owner_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn playlist_owner_id(database: &Database, playlist_id: &str) -> Result<Option<i64>> {
    Ok(
        entity::playlists::Entity::find_by_id(playlist_id.to_string())
            .select_only()
            .column(entity::playlists::Column::OwnerId)
            .into_tuple::<i64>()
            .one(database.conn())
            .await?,
    )
}

pub async fn user_exists(database: &Database, user_id: i64) -> Result<bool> {
    Ok(entity::users::Entity::find_by_id(user_id)
        .select_only()
        .column(entity::users::Column::Id)
        .into_tuple::<i64>()
        .one(database.conn())
        .await?
        .is_some())
}

pub async fn username_for_user(database: &Database, user_id: i64) -> Result<Option<String>> {
    Ok(entity::users::Entity::find_by_id(user_id)
        .select_only()
        .column(entity::users::Column::Username)
        .into_tuple::<String>()
        .one(database.conn())
        .await?)
}

pub async fn fetch_playlist_shares(
    database: &Database,
    playlist_id: &str,
) -> Result<Vec<PlaylistShareRecord>> {
    let rows = entity::playlist_shares::Entity::find()
        .select_only()
        .column_as(entity::playlist_shares::Column::SharedWithUserId, "user_id")
        .column_as(
            Expr::col((entity::users::Entity, entity::users::Column::Username)),
            "username",
        )
        .column(entity::playlist_shares::Column::CanEdit)
        .join(
            JoinType::InnerJoin,
            entity::playlist_shares::Relation::Users.def(),
        )
        .filter(entity::playlist_shares::Column::PlaylistId.eq(playlist_id))
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::users::Entity, entity::users::Column::Username),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::users::Entity, entity::users::Column::Username)),
            Order::Asc,
        )
        .into_model::<PlaylistShareQueryRow>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| PlaylistShareRecord {
            user_id: row.user_id,
            username: row.username,
            can_edit: row.can_edit,
        })
        .collect())
}

pub async fn replace_playlist_shares(
    database: &Database,
    playlist_id: &str,
    shares: &[PlaylistShareInput],
) -> Result<()> {
    let tx = database.conn().begin().await?;

    entity::playlist_shares::Entity::delete_many()
        .filter(entity::playlist_shares::Column::PlaylistId.eq(playlist_id))
        .exec(&tx)
        .await?;

    for share in shares {
        entity::playlist_shares::ActiveModel {
            playlist_id: Set(playlist_id.to_string()),
            shared_with_user_id: Set(share.user_id),
            can_edit: Set(share.can_edit),
            created_at: Set(Utc::now().fixed_offset()),
        }
        .insert(&tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_playlist_folders_for_user(
    database: &Database,
    user_id: i64,
) -> Result<Vec<PlaylistFolderRecord>> {
    let rows = playlist_folder_select(database)
        .filter(entity::playlist_folders::Column::OwnerId.eq(user_id))
        .into_model::<PlaylistFolderQueryRow>()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| PlaylistFolderRecord {
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
            position: row.position,
            created_at: row.created_at,
            has_cover_art: row.has_cover_art,
        })
        .collect())
}

pub async fn list_visible_playlists_for_user(
    database: &Database,
    user_id: i64,
) -> Result<Vec<PlaylistListingRecord>> {
    let owned_rows = entity::playlists::Entity::find()
        .select_only()
        .column(entity::playlists::Column::Id)
        .column(entity::playlists::Column::Name)
        .column(entity::playlists::Column::FolderId)
        .column(entity::playlists::Column::Position)
        .column(entity::playlists::Column::SongCount)
        .column(entity::playlists::Column::UpdatedAt)
        .filter(entity::playlists::Column::OwnerId.eq(user_id))
        .order_by_asc(entity::playlists::Column::Position)
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::playlists::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::playlists::Column::Name)
        .into_model::<OwnedPlaylistQueryRow>()
        .all(database.conn())
        .await?;

    let shared_rows = entity::playlist_shares::Entity::find()
        .select_only()
        .column_as(
            Expr::col((entity::playlists::Entity, entity::playlists::Column::Id)),
            "id",
        )
        .column_as(
            Expr::col((entity::playlists::Entity, entity::playlists::Column::Name)),
            "name",
        )
        .column_as(
            Expr::col((
                entity::playlists::Entity,
                entity::playlists::Column::Position,
            )),
            "position",
        )
        .column_as(
            Expr::col((
                entity::playlists::Entity,
                entity::playlists::Column::SongCount,
            )),
            "song_count",
        )
        .column_as(
            Expr::col((entity::users::Entity, entity::users::Column::Username)),
            "owner_name",
        )
        .column(entity::playlist_shares::Column::CanEdit)
        .column_as(
            Expr::col((
                entity::playlists::Entity,
                entity::playlists::Column::UpdatedAt,
            )),
            "updated_at",
        )
        .join(
            JoinType::InnerJoin,
            entity::playlist_shares::Relation::Playlists.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::playlists::Relation::Users.def(),
        )
        .filter(entity::playlist_shares::Column::SharedWithUserId.eq(user_id))
        .order_by(
            case_insensitive_order(
                database.sea_backend(),
                (entity::playlists::Entity, entity::playlists::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            Expr::col((entity::playlists::Entity, entity::playlists::Column::Name)),
            Order::Asc,
        )
        .into_model::<SharedPlaylistQueryRow>()
        .all(database.conn())
        .await?;

    let shared_ids = shared_rows
        .iter()
        .map(|playlist| playlist.id.clone())
        .collect::<Vec<_>>();

    let mut public_query = entity::playlists::Entity::find()
        .select_only()
        .column(entity::playlists::Column::Id)
        .column(entity::playlists::Column::Name)
        .column(entity::playlists::Column::Position)
        .column(entity::playlists::Column::SongCount)
        .column_as(
            Expr::col((entity::users::Entity, entity::users::Column::Username)),
            "owner_name",
        )
        .column_as(Expr::value(false), "can_edit")
        .column(entity::playlists::Column::UpdatedAt)
        .join(
            JoinType::InnerJoin,
            entity::playlists::Relation::Users.def(),
        )
        .filter(entity::playlists::Column::IsPublic.eq(true))
        .filter(entity::playlists::Column::OwnerId.ne(user_id));

    if !shared_ids.is_empty() {
        public_query = public_query.filter(entity::playlists::Column::Id.is_not_in(shared_ids));
    }

    let public_rows = public_query
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::playlists::Column::Name),
            Order::Asc,
        )
        .order_by_asc(entity::playlists::Column::Name)
        .into_model::<SharedPlaylistQueryRow>()
        .all(database.conn())
        .await?;

    let all_ids = owned_rows
        .iter()
        .map(|playlist| playlist.id.clone())
        .chain(shared_rows.iter().map(|playlist| playlist.id.clone()))
        .chain(public_rows.iter().map(|playlist| playlist.id.clone()))
        .collect::<Vec<_>>();
    let duration_map = fetch_playlist_duration_map(database, &all_ids).await?;
    let override_map = fetch_playlist_override_map(database, user_id, &all_ids).await?;

    let mut playlists = Vec::with_capacity(all_ids.len());

    playlists.extend(owned_rows.into_iter().map(|row| PlaylistListingRecord {
        duration: duration_map.get(&row.id).copied().unwrap_or(0),
        owner_name: None,
        shared_with_me: false,
        can_edit: true,
        id: row.id,
        name: row.name,
        folder_id: row.folder_id,
        position: row.position,
        song_count: row.song_count,
        updated_at: row.updated_at,
    }));

    playlists.extend(shared_rows.into_iter().map(|row| PlaylistListingRecord {
        duration: duration_map.get(&row.id).copied().unwrap_or(0),
        folder_id: override_map.get(&row.id).cloned().flatten(),
        owner_name: Some(row.owner_name),
        shared_with_me: true,
        can_edit: row.can_edit,
        id: row.id,
        name: row.name,
        position: row.position,
        song_count: row.song_count,
        updated_at: row.updated_at,
    }));

    playlists.extend(public_rows.into_iter().map(|row| PlaylistListingRecord {
        duration: duration_map.get(&row.id).copied().unwrap_or(0),
        folder_id: override_map.get(&row.id).cloned().flatten(),
        owner_name: Some(row.owner_name),
        shared_with_me: false,
        can_edit: false,
        id: row.id,
        name: row.name,
        position: row.position,
        song_count: row.song_count,
        updated_at: row.updated_at,
    }));

    Ok(playlists)
}

/// Touch `playlists.last_played_at` to now.
pub async fn touch_playlist_last_played(database: &Database, playlist_id: &str) -> Result<()> {
    entity::playlists::Entity::update_many()
        .col_expr(
            entity::playlists::Column::LastPlayedAt,
            Expr::current_timestamp().into(),
        )
        .filter(entity::playlists::Column::Id.eq(playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Touch `smart_playlists.last_played_at` to now.
pub async fn touch_smart_playlist_last_played(
    database: &Database,
    smart_playlist_id: &str,
) -> Result<()> {
    entity::smart_playlists::Entity::update_many()
        .col_expr(
            entity::smart_playlists::Column::LastPlayedAt,
            Expr::current_timestamp().into(),
        )
        .filter(entity::smart_playlists::Column::Id.eq(smart_playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Admin API playlist mutation helpers (migrated from raw SQL).
// ---------------------------------------------------------------------------

/// Update a playlist's `folder_id` (owner path).
pub async fn set_playlist_folder_id(
    database: &Database,
    playlist_id: &str,
    folder_id: Option<String>,
) -> Result<()> {
    entity::playlists::Entity::update_many()
        .col_expr(entity::playlists::Column::FolderId, Expr::value(folder_id))
        .filter(entity::playlists::Column::Id.eq(playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Upsert a user's per-playlist folder override (non-owner path).
pub async fn upsert_user_playlist_override(
    database: &Database,
    user_id: i64,
    playlist_id: &str,
    folder_id: Option<String>,
) -> Result<()> {
    use entity::user_playlist_overrides as upo;
    use sea_orm::sea_query::OnConflict;
    let active = upo::ActiveModel {
        user_id: Set(user_id),
        playlist_id: Set(playlist_id.to_string()),
        folder_id: Set(folder_id),
    };
    upo::Entity::insert(active)
        .on_conflict(
            OnConflict::columns([upo::Column::UserId, upo::Column::PlaylistId])
                .update_column(upo::Column::FolderId)
                .to_owned(),
        )
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Delete a user's per-playlist folder override.
pub async fn delete_user_playlist_override(
    database: &Database,
    user_id: i64,
    playlist_id: &str,
) -> Result<()> {
    entity::user_playlist_overrides::Entity::delete_many()
        .filter(entity::user_playlist_overrides::Column::UserId.eq(user_id))
        .filter(entity::user_playlist_overrides::Column::PlaylistId.eq(playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Row for a single playlist entry (by `entry_id`).
#[derive(Debug, Clone, FromQueryResult)]
pub struct PlaylistEntryByEntryIdRow {
    pub song_id: Option<String>,
    pub missing_entry_data: Option<String>,
}

pub async fn get_playlist_entry_by_entry_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
) -> Result<Option<PlaylistEntryByEntryIdRow>> {
    use entity::playlist_songs::Column as P;
    let row = entity::playlist_songs::Entity::find()
        .select_only()
        .column(P::SongId)
        .column(P::MissingEntryData)
        .filter(P::PlaylistId.eq(playlist_id))
        .filter(P::EntryId.eq(entry_id))
        .into_model::<PlaylistEntryByEntryIdRow>()
        .one(database.conn())
        .await?;
    Ok(row)
}

/// Check whether a song with the given id exists.
pub async fn song_exists(database: &Database, song_id: &str) -> Result<bool> {
    let found: Option<String> = entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::Id)
        .into_tuple()
        .one(database.conn())
        .await?;
    Ok(found.is_some())
}

/// All playlist_songs entries for a playlist, ordered by position.
#[derive(Debug, Clone, FromQueryResult)]
pub struct PlaylistSongReorderRow {
    pub song_id: String,
    pub added_at: DateTime<Utc>,
    pub entry_id: Option<String>,
}

pub async fn list_playlist_songs_for_reorder(
    database: &Database,
    playlist_id: &str,
) -> Result<Vec<PlaylistSongReorderRow>> {
    use entity::playlist_songs::Column as P;
    let rows: Vec<(Option<String>, DateTime<Utc>, Option<String>)> =
        entity::playlist_songs::Entity::find()
            .select_only()
            .column(P::SongId)
            .column(P::AddedAt)
            .column(P::EntryId)
            .filter(P::PlaylistId.eq(playlist_id))
            .filter(P::SongId.is_not_null())
            .order_by_asc(P::Position)
            .into_tuple()
            .all(database.conn())
            .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(sid, added, eid)| {
            sid.map(|song_id| PlaylistSongReorderRow {
                song_id,
                added_at: added,
                entry_id: eid,
            })
        })
        .collect())
}

/// Full entry row used by the list-entries endpoint.
#[derive(Debug, Clone, FromQueryResult)]
pub struct PlaylistEntryFullRow {
    pub position: i64,
    pub song_id: Option<String>,
    pub missing_entry_data: Option<String>,
    pub missing_search_text: Option<String>,
    pub added_at: DateTime<Utc>,
    pub entry_id: Option<String>,
}

pub async fn list_playlist_entries_full(
    database: &Database,
    playlist_id: &str,
) -> Result<Vec<PlaylistEntryFullRow>> {
    use entity::playlist_songs::Column as P;
    let rows = entity::playlist_songs::Entity::find()
        .select_only()
        .column(P::Position)
        .column(P::SongId)
        .column(P::MissingEntryData)
        .column(P::MissingSearchText)
        .column(P::AddedAt)
        .column(P::EntryId)
        .filter(P::PlaylistId.eq(playlist_id))
        .order_by_asc(P::Position)
        .into_model::<PlaylistEntryFullRow>()
        .all(database.conn())
        .await?;
    Ok(rows)
}

/// Delete all songs from a playlist (inside a transaction).
pub async fn delete_all_playlist_songs<C: sea_orm::ConnectionTrait>(
    conn: &C,
    playlist_id: &str,
) -> Result<()> {
    entity::playlist_songs::Entity::delete_many()
        .filter(entity::playlist_songs::Column::PlaylistId.eq(playlist_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Insert a single playlist song entry at a given position.
#[allow(clippy::too_many_arguments)]
pub async fn insert_playlist_song_entry<C: sea_orm::ConnectionTrait>(
    conn: &C,
    playlist_id: &str,
    song_id: &str,
    position: i64,
    added_at: DateTime<Utc>,
    entry_id: &str,
) -> Result<()> {
    let active = entity::playlist_songs::ActiveModel {
        playlist_id: Set(playlist_id.to_string()),
        song_id: Set(Some(song_id.to_string())),
        position: Set(position),
        missing_entry_data: Set(None),
        missing_search_text: Set(None),
        added_at: Set(added_at.fixed_offset()),
        entry_id: Set(Some(entry_id.to_string())),
    };
    entity::playlist_songs::Entity::insert(active)
        .exec(conn)
        .await?;
    Ok(())
}

/// Get current position of an entry by its `entry_id`.
pub async fn get_entry_position_by_entry_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
) -> Result<Option<i64>> {
    let row: Option<i64> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(entity::playlist_songs::Column::Position)
        .filter(entity::playlist_songs::Column::PlaylistId.eq(playlist_id))
        .filter(entity::playlist_songs::Column::EntryId.eq(entry_id))
        .into_tuple()
        .one(database.conn())
        .await?;
    Ok(row)
}

/// Count entries in a playlist.
pub async fn count_playlist_entries(database: &Database, playlist_id: &str) -> Result<i64> {
    use entity::playlist_songs::Column as P;
    let count: i64 = entity::playlist_songs::Entity::find()
        .select_only()
        .expr_as(P::PlaylistId.count(), "c")
        .filter(P::PlaylistId.eq(playlist_id))
        .into_tuple()
        .one(database.conn())
        .await?
        .unwrap_or(0);
    Ok(count)
}

/// Update `position` of entries matching a given position within a playlist.
/// Accepts a raw numeric expression so the caller can use expressions like
/// `position - 1` or a literal position.
pub async fn update_entry_position_at<C: sea_orm::ConnectionTrait>(
    conn: &C,
    playlist_id: &str,
    current_position: i64,
    new_value: sea_orm::sea_query::SimpleExpr,
) -> Result<()> {
    entity::playlist_songs::Entity::update_many()
        .col_expr(entity::playlist_songs::Column::Position, new_value)
        .filter(entity::playlist_songs::Column::PlaylistId.eq(playlist_id))
        .filter(entity::playlist_songs::Column::Position.eq(current_position))
        .exec(conn)
        .await?;
    Ok(())
}

/// Transfer playlist ownership and bump `updated_at`.
pub async fn transfer_playlist_ownership(
    database: &Database,
    playlist_id: &str,
    new_owner_id: i64,
) -> Result<()> {
    entity::playlists::Entity::update_many()
        .col_expr(
            entity::playlists::Column::OwnerId,
            Expr::value(new_owner_id),
        )
        .col_expr(
            entity::playlists::Column::UpdatedAt,
            Expr::current_timestamp().into(),
        )
        .filter(entity::playlists::Column::Id.eq(playlist_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Remove any share entries for a user on a playlist (used after ownership
/// transfer).
pub async fn remove_playlist_share(
    database: &Database,
    playlist_id: &str,
    shared_with_user_id: i64,
) -> Result<()> {
    entity::playlist_shares::Entity::delete_many()
        .filter(entity::playlist_shares::Column::PlaylistId.eq(playlist_id))
        .filter(entity::playlist_shares::Column::SharedWithUserId.eq(shared_with_user_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// `(song_id, playlist_id, playlist_name)` rows for playlists containing any
/// of the given songs that the user owns.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SongPlaylistRow {
    pub song_id: String,
    pub playlist_id: String,
    pub playlist_name: String,
}

pub async fn list_owner_playlists_containing_songs(
    database: &Database,
    owner_id: i64,
    song_ids: &[String],
) -> Result<Vec<SongPlaylistRow>> {
    use entity::playlist_songs::Column as PS;
    let rows: Vec<(Option<String>, String, String)> = entity::playlist_songs::Entity::find()
        .select_only()
        .column(PS::SongId)
        .column_as(entity::playlists::Column::Id, "playlist_id")
        .column_as(entity::playlists::Column::Name, "playlist_name")
        .join(
            JoinType::InnerJoin,
            entity::playlist_songs::Relation::Playlists.def(),
        )
        .filter(PS::SongId.is_in(song_ids.iter().cloned()))
        .filter(entity::playlists::Column::OwnerId.eq(owner_id))
        .filter(PS::SongId.is_not_null())
        .order_by_asc(case_insensitive_order(
            database.sea_backend(),
            entity::playlists::Column::Name,
        ))
        .order_by_asc(entity::playlists::Column::Name)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(sid, pid, pname)| {
            sid.map(|song_id| SongPlaylistRow {
                song_id,
                playlist_id: pid,
                playlist_name: pname,
            })
        })
        .collect())
}

/// Recently-played regular playlist row (owner or shared).
#[derive(Debug, Clone, FromQueryResult)]
pub struct RecentRegularPlaylistRow {
    pub id: String,
    pub name: String,
    pub song_count: i64,
    pub duration: i64,
    pub last_played_at: DateTime<Utc>,
}

pub async fn list_recent_regular_playlists(
    database: &Database,
    user_id: i64,
) -> Result<Vec<RecentRegularPlaylistRow>> {
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

    let share_exists = SqQuery::select()
        .expr(Expr::val(1))
        .from(entity::playlist_shares::Entity)
        .and_where(
            Expr::col((
                entity::playlist_shares::Entity,
                entity::playlist_shares::Column::PlaylistId,
            ))
            .equals((entity::playlists::Entity, entity::playlists::Column::Id)),
        )
        .and_where(
            Expr::col((
                entity::playlist_shares::Entity,
                entity::playlist_shares::Column::SharedWithUserId,
            ))
            .eq(user_id),
        )
        .to_owned();

    use sea_orm::sea_query::SimpleExpr;
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
        .column(entity::playlists::Column::LastPlayedAt)
        .filter(entity::playlists::Column::LastPlayedAt.is_not_null())
        .filter(
            sea_orm::Condition::any()
                .add(entity::playlists::Column::OwnerId.eq(user_id))
                .add(Expr::exists(share_exists)),
        )
        .order_by_desc(entity::playlists::Column::LastPlayedAt)
        .limit(50)
        .into_model::<RecentRegularPlaylistRow>()
        .all(database.conn())
        .await?;
    Ok(rows
        .into_iter()
        .map(|mut r| {
            // SUM can return NULL when the playlist has no songs; treat as 0.
            if r.duration < 0 {
                r.duration = 0;
            }
            r
        })
        .collect())
}

/// Recently-played smart playlist row.
#[derive(Debug, Clone, FromQueryResult)]
pub struct RecentSmartPlaylistRow {
    pub id: String,
    pub name: String,
    pub last_played_at: DateTime<Utc>,
}

pub async fn list_recent_smart_playlists(
    database: &Database,
    owner_id: i64,
) -> Result<Vec<RecentSmartPlaylistRow>> {
    use entity::smart_playlists::Column as SP;
    let rows = entity::smart_playlists::Entity::find()
        .select_only()
        .column(SP::Id)
        .column(SP::Name)
        .column(SP::LastPlayedAt)
        .filter(SP::OwnerId.eq(owner_id))
        .filter(SP::LastPlayedAt.is_not_null())
        .order_by_desc(SP::LastPlayedAt)
        .limit(50)
        .into_model::<RecentSmartPlaylistRow>()
        .all(database.conn())
        .await?;
    Ok(rows)
}
