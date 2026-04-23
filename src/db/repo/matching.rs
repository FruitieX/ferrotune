//! SeaORM-backed queries supporting the server-side fuzzy matching
//! endpoints and the user's match dictionary.

use chrono::Utc;
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue, ColumnTrait, Condition, EntityTrait, FromQueryResult, JoinType, Order,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait,
};

use crate::db::entity;
use crate::db::ordering::case_insensitive_order;
use crate::db::Database;
use crate::error::Result;

// ---------------------------------------------------------------------------
// Minimal projected rows (kept local so call sites keep their own public
// response types). The field names match the caller-side structs so
// `into_model` lines up.
// ---------------------------------------------------------------------------

fn visible_song_folder_subquery(
    user_id: i64,
    library_id: Option<i64>,
) -> sea_orm::sea_query::SelectStatement {
    let mut q = entity::music_folders::Entity::find()
        .select_only()
        .column(entity::music_folders::Column::Id)
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id));
    if let Some(id) = library_id {
        q = q.filter(entity::music_folders::Column::Id.eq(id));
    }
    q.into_query()
}

// ---------------------------------------------------------------------------
// Song match-list
// ---------------------------------------------------------------------------

/// Fetch all songs in a user's accessible, enabled libraries, optionally
/// scoped to a specific music folder. Results are ordered case-insensitively
/// by artist, album, disc/track, then title.
///
/// The caller provides the row model as `T` so we don't duplicate the
/// `SongMatchEntry` struct here.
pub async fn fetch_song_match_entries<T: FromQueryResult>(
    database: &Database,
    user_id: i64,
    library_id: Option<i64>,
) -> Result<Vec<T>> {
    let backend = database.sea_backend();
    let folder_subq = visible_song_folder_subquery(user_id, library_id);

    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::Title)
        .column_as(entity::artists::Column::Name, "artist")
        .column_as(entity::albums::Column::Name, "album")
        .column(entity::songs::Column::Duration)
        .join(JoinType::InnerJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(entity::songs::Column::MusicFolderId.in_subquery(folder_subq))
        .order_by(
            case_insensitive_order(
                backend,
                (entity::artists::Entity, entity::artists::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(
            case_insensitive_order(
                backend,
                (entity::albums::Entity, entity::albums::Column::Name),
            ),
            Order::Asc,
        )
        .order_by(entity::songs::Column::DiscNumber, Order::Asc)
        .order_by(entity::songs::Column::TrackNumber, Order::Asc)
        .order_by(
            case_insensitive_order(
                backend,
                (entity::songs::Entity, entity::songs::Column::Title),
            ),
            Order::Asc,
        )
        .into_model::<T>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Album match-list
// ---------------------------------------------------------------------------

/// Fetch DISTINCT albums for all songs visible to `user_id`, optionally
/// scoped to `library_id`. The projection is `id, name, artist, year` to
/// match the `AlbumMatchEntry` shape.
pub async fn fetch_album_match_entries<T: FromQueryResult>(
    database: &Database,
    user_id: i64,
    library_id: Option<i64>,
) -> Result<Vec<T>> {
    let folder_subq = visible_song_folder_subquery(user_id, library_id);

    // SELECT DISTINCT al.id, al.name, ar.name, al.year FROM albums al JOIN
    // artists ar ON al.artist_id=ar.id JOIN songs s ON s.album_id=al.id
    // WHERE s.music_folder_id IN (...)
    entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .column(entity::albums::Column::Name)
        .column_as(entity::artists::Column::Name, "artist")
        .column(entity::albums::Column::Year)
        .join(JoinType::InnerJoin, entity::albums::Relation::Artists.def())
        .join(JoinType::InnerJoin, entity::albums::Relation::Songs.def())
        .filter(entity::songs::Column::MusicFolderId.in_subquery(folder_subq))
        .distinct()
        .into_model::<T>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Artist match-list
// ---------------------------------------------------------------------------

pub async fn fetch_artist_match_entries<T: FromQueryResult>(
    database: &Database,
    user_id: i64,
    library_id: Option<i64>,
) -> Result<Vec<T>> {
    let folder_subq = visible_song_folder_subquery(user_id, library_id);

    entity::artists::Entity::find()
        .select_only()
        .column(entity::artists::Column::Id)
        .column(entity::artists::Column::Name)
        .join(JoinType::InnerJoin, entity::artists::Relation::Songs.def())
        .filter(entity::songs::Column::MusicFolderId.in_subquery(folder_subq))
        .distinct()
        .into_model::<T>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

// ---------------------------------------------------------------------------
// Match dictionary
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct DictRow {
    pub original_title: Option<String>,
    pub original_artist: Option<String>,
    pub original_album: Option<String>,
    pub original_duration_ms: Option<i32>,
    pub song_id: String,
}

pub async fn list_match_dictionary(database: &Database, user_id: i64) -> Result<Vec<DictRow>> {
    entity::match_dictionary::Entity::find()
        .select_only()
        .column(entity::match_dictionary::Column::OriginalTitle)
        .column(entity::match_dictionary::Column::OriginalArtist)
        .column(entity::match_dictionary::Column::OriginalAlbum)
        .column(entity::match_dictionary::Column::OriginalDurationMs)
        .column(entity::match_dictionary::Column::SongId)
        .filter(entity::match_dictionary::Column::UserId.eq(user_id))
        .into_model::<DictRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct LegacyDictRow {
    pub missing_entry_data: String,
    pub song_id: String,
}

/// Fetch legacy per-playlist match data (rows with `missing_entry_data`
/// JSON and a resolved song_id) for a user's owned playlists.
pub async fn list_legacy_match_entries(
    database: &Database,
    user_id: i64,
) -> Result<Vec<LegacyDictRow>> {
    entity::playlist_songs::Entity::find()
        .select_only()
        .column(entity::playlist_songs::Column::MissingEntryData)
        .column(entity::playlist_songs::Column::SongId)
        .join(
            JoinType::InnerJoin,
            entity::playlist_songs::Relation::Playlists.def(),
        )
        .filter(entity::playlists::Column::OwnerId.eq(user_id))
        .filter(
            Condition::all()
                .add(entity::playlist_songs::Column::MissingEntryData.is_not_null())
                .add(entity::playlist_songs::Column::SongId.is_not_null()),
        )
        .distinct()
        .into_model::<LegacyDictRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

/// Insert or update an entry in the match dictionary, keyed on
/// `(user_id, lookup_key)`. Returns true if a row was written.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_match_dictionary_entry(
    database: &Database,
    user_id: i64,
    lookup_key: &str,
    original_title: Option<&str>,
    original_artist: Option<&str>,
    original_album: Option<&str>,
    original_duration_ms: Option<i32>,
    song_id: &str,
) -> Result<bool> {
    let now = Utc::now().into();
    let am = entity::match_dictionary::ActiveModel {
        id: ActiveValue::NotSet,
        user_id: ActiveValue::Set(user_id),
        lookup_key: ActiveValue::Set(lookup_key.to_string()),
        original_title: ActiveValue::Set(original_title.map(str::to_string)),
        original_artist: ActiveValue::Set(original_artist.map(str::to_string)),
        original_album: ActiveValue::Set(original_album.map(str::to_string)),
        original_duration_ms: ActiveValue::Set(original_duration_ms),
        song_id: ActiveValue::Set(song_id.to_string()),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
    };

    let res = entity::match_dictionary::Entity::insert(am)
        .on_conflict(
            OnConflict::columns([
                entity::match_dictionary::Column::UserId,
                entity::match_dictionary::Column::LookupKey,
            ])
            .update_columns([
                entity::match_dictionary::Column::OriginalTitle,
                entity::match_dictionary::Column::OriginalArtist,
                entity::match_dictionary::Column::OriginalAlbum,
                entity::match_dictionary::Column::OriginalDurationMs,
                entity::match_dictionary::Column::SongId,
                entity::match_dictionary::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec(database.conn())
        .await?;

    // sea_orm returns last_insert_id. For upsert we treat any successful
    // exec as one row affected.
    let _ = res;
    Ok(true)
}
