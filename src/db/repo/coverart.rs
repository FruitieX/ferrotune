//! SeaORM-backed queries supporting the cover art endpoint.

use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

fn album_to_thumb() -> sea_orm::RelationDef {
    entity::albums::Entity::belongs_to(entity::cover_art_thumbnails::Entity)
        .from(entity::albums::Column::CoverArtHash)
        .to(entity::cover_art_thumbnails::Column::Hash)
        .into()
}

fn artist_to_thumb() -> sea_orm::RelationDef {
    entity::artists::Entity::belongs_to(entity::cover_art_thumbnails::Entity)
        .from(entity::artists::Column::CoverArtHash)
        .to(entity::cover_art_thumbnails::Column::Hash)
        .into()
}

fn song_to_thumb() -> sea_orm::RelationDef {
    entity::songs::Entity::belongs_to(entity::cover_art_thumbnails::Entity)
        .from(entity::songs::Column::CoverArtHash)
        .to(entity::cover_art_thumbnails::Column::Hash)
        .into()
}

/// Fetch an album's `cover_art_hash`, if any.
pub async fn get_album_cover_art_hash(
    database: &Database,
    album_id: &str,
) -> Result<Option<String>> {
    let row: Option<(Option<String>,)> = entity::albums::Entity::find_by_id(album_id.to_string())
        .select_only()
        .column(entity::albums::Column::CoverArtHash)
        .into_tuple()
        .one(database.conn())
        .await?;
    Ok(row.and_then(|(h,)| h))
}

/// A song's relative `file_path` joined with its music-folder `folder_path`.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SongFolderPath {
    pub file_path: String,
    pub folder_path: String,
}

/// Fetch the earliest track (by disc/track number) in an album along with
/// its owning music-folder path. Used to locate a file on disk to extract
/// cover art from.
pub async fn get_album_first_track_folder_path(
    database: &Database,
    album_id: &str,
) -> Result<Option<SongFolderPath>> {
    entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::FilePath)
        .column_as(entity::music_folders::Column::Path, "folder_path")
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .filter(entity::songs::Column::AlbumId.eq(album_id))
        .order_by(entity::songs::Column::DiscNumber, Order::Asc)
        .order_by(entity::songs::Column::TrackNumber, Order::Asc)
        .into_model::<SongFolderPath>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch a song's relative `file_path` and its music-folder `folder_path`.
pub async fn get_song_folder_path(
    database: &Database,
    song_id: &str,
) -> Result<Option<SongFolderPath>> {
    entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::FilePath)
        .column_as(entity::music_folders::Column::Path, "folder_path")
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .into_model::<SongFolderPath>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch up to 4 distinct cover-art hashes for a playlist, ordered by
/// the playlist's own song ordering.
pub async fn get_playlist_cover_art_hashes(
    database: &Database,
    playlist_id: &str,
) -> Result<Vec<String>> {
    let rows: Vec<(Option<String>,)> = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::CoverArtHash)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::PlaylistSongs.def(),
        )
        .filter(entity::playlist_songs::Column::PlaylistId.eq(playlist_id))
        .filter(entity::songs::Column::CoverArtHash.is_not_null())
        .distinct()
        .order_by(entity::playlist_songs::Column::Position, Order::Asc)
        .limit(4)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().filter_map(|(h,)| h).collect())
}

/// Minimal projection of a smart playlist for cover-art materialization.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SmartPlaylistCoverArtRow {
    pub rules_json: String,
    pub owner_id: i64,
    pub max_songs: Option<i64>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
}

pub async fn get_smart_playlist_for_cover_art(
    database: &Database,
    smart_playlist_id: &str,
) -> Result<Option<SmartPlaylistCoverArtRow>> {
    entity::smart_playlists::Entity::find_by_id(smart_playlist_id.to_string())
        .select_only()
        .column(entity::smart_playlists::Column::RulesJson)
        .column(entity::smart_playlists::Column::OwnerId)
        .column(entity::smart_playlists::Column::MaxSongs)
        .column(entity::smart_playlists::Column::SortField)
        .column(entity::smart_playlists::Column::SortDirection)
        .into_model::<SmartPlaylistCoverArtRow>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Fetch a playlist folder's stored `cover_art` blob, if any.
pub async fn get_playlist_folder_cover_art(
    database: &Database,
    folder_id: &str,
) -> Result<Option<Vec<u8>>> {
    let row: Option<(Option<Vec<u8>>,)> =
        entity::playlist_folders::Entity::find_by_id(folder_id.to_string())
            .select_only()
            .column(entity::playlist_folders::Column::CoverArt)
            .filter(entity::playlist_folders::Column::CoverArt.is_not_null())
            .into_tuple()
            .one(database.conn())
            .await?;
    Ok(row.and_then(|(b,)| b))
}

/// Check whether a `cover_art_thumbnails` row exists for the given hash.
pub async fn thumbnail_exists(database: &Database, hash: &str) -> Result<bool> {
    let found = entity::cover_art_thumbnails::Entity::find_by_id(hash.to_string())
        .select_only()
        .column(entity::cover_art_thumbnails::Column::Hash)
        .into_tuple::<String>()
        .one(database.conn())
        .await?;
    Ok(found.is_some())
}

/// Upsert a thumbnail pair (small + medium JPEGs) keyed by hash, doing
/// nothing on conflict.
pub async fn insert_thumbnail_pair(
    database: &Database,
    hash: &str,
    small: Vec<u8>,
    medium: Vec<u8>,
) -> Result<()> {
    use sea_orm::sea_query::OnConflict;
    use sea_orm::ActiveValue;
    let now = chrono::Utc::now().fixed_offset();
    let model = entity::cover_art_thumbnails::ActiveModel {
        hash: ActiveValue::Set(hash.to_string()),
        small: ActiveValue::Set(small),
        medium: ActiveValue::Set(medium),
        updated_at: ActiveValue::Set(now),
    };
    let _ = entity::cover_art_thumbnails::Entity::insert(model)
        .on_conflict(
            OnConflict::column(entity::cover_art_thumbnails::Column::Hash)
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Fetch a small or medium thumbnail blob by hash.
pub async fn get_thumbnail_blob(
    database: &Database,
    hash: &str,
    medium: bool,
) -> Result<Option<Vec<u8>>> {
    use entity::cover_art_thumbnails::Column as C;
    let column = if medium { C::Medium } else { C::Small };
    let row: Option<(Vec<u8>,)> =
        entity::cover_art_thumbnails::Entity::find_by_id(hash.to_string())
            .select_only()
            .column(column)
            .into_tuple()
            .one(database.conn())
            .await?;
    Ok(row.map(|(b,)| b))
}

fn thumbnail_column(medium: bool) -> entity::cover_art_thumbnails::Column {
    if medium {
        entity::cover_art_thumbnails::Column::Medium
    } else {
        entity::cover_art_thumbnails::Column::Small
    }
}

/// Fetch thumbnails (keyed by album id) for the given album ids.
pub async fn fetch_album_thumbnails(
    database: &Database,
    album_ids: &[String],
    medium: bool,
) -> Result<Vec<(String, Vec<u8>)>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }
    let col = thumbnail_column(medium);
    let rows: Vec<(String, Vec<u8>)> = entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .column_as(col, "thumbnail")
        .join(JoinType::InnerJoin, album_to_thumb())
        .filter(entity::albums::Column::Id.is_in(album_ids.iter().cloned()))
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows)
}

/// Fetch thumbnails keyed by artist id for artists with their own
/// `cover_art_hash` pointing to `cover_art_thumbnails`.
pub async fn fetch_artist_own_thumbnails(
    database: &Database,
    artist_ids: &[String],
    medium: bool,
) -> Result<Vec<(String, Vec<u8>)>> {
    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }
    let col = thumbnail_column(medium);
    let rows: Vec<(String, Vec<u8>)> = entity::artists::Entity::find()
        .select_only()
        .column(entity::artists::Column::Id)
        .column_as(col, "thumbnail")
        .join(JoinType::InnerJoin, artist_to_thumb())
        .filter(entity::artists::Column::Id.is_in(artist_ids.iter().cloned()))
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows)
}

/// Fetch `(artist_id, thumbnail_blob)` rows for albums whose artists are in
/// `artist_ids`, ordered so the caller can pick the first thumbnail per
/// artist as an album-level fallback.
pub async fn fetch_album_thumbnails_by_artists(
    database: &Database,
    artist_ids: &[String],
    medium: bool,
) -> Result<Vec<(String, Vec<u8>)>> {
    if artist_ids.is_empty() {
        return Ok(Vec::new());
    }
    let col = thumbnail_column(medium);
    let rows: Vec<(Option<String>, Vec<u8>)> = entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::ArtistId)
        .column_as(col, "thumbnail")
        .join(JoinType::InnerJoin, album_to_thumb())
        .filter(entity::albums::Column::ArtistId.is_in(artist_ids.iter().cloned()))
        .filter(entity::albums::Column::CoverArtHash.is_not_null())
        .order_by_asc(entity::albums::Column::ArtistId)
        .order_by_asc(entity::albums::Column::CreatedAt)
        .order_by_asc(entity::albums::Column::Id)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(aid, blob)| aid.map(|a| (a, blob)))
        .collect())
}

/// Fetch thumbnails (keyed by song id) for songs whose own `cover_art_hash`
/// points at a thumbnail row.
pub async fn fetch_song_own_thumbnails(
    database: &Database,
    song_ids: &[String],
    medium: bool,
) -> Result<Vec<(String, Vec<u8>)>> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }
    let col = thumbnail_column(medium);
    let rows: Vec<(String, Vec<u8>)> = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column_as(col, "thumbnail")
        .join(JoinType::InnerJoin, song_to_thumb())
        .filter(entity::songs::Column::Id.is_in(song_ids.iter().cloned()))
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows)
}

/// Fetch up to `limit` song thumbnails for the given playlist, ordered by
/// playlist position. Returns `(hash, thumbnail)` pairs.
pub async fn fetch_playlist_song_thumbnails(
    database: &Database,
    playlist_id: &str,
    medium: bool,
    limit: u64,
) -> Result<Vec<(String, Vec<u8>)>> {
    let col = thumbnail_column(medium);
    let rows: Vec<(String, Vec<u8>)> = entity::playlist_songs::Entity::find()
        .select_only()
        .column_as(entity::cover_art_thumbnails::Column::Hash, "hash")
        .column_as(col, "thumbnail")
        .join(
            JoinType::InnerJoin,
            entity::playlist_songs::Relation::Songs.def(),
        )
        .join(JoinType::InnerJoin, song_to_thumb())
        .filter(entity::playlist_songs::Column::PlaylistId.eq(playlist_id))
        .filter(entity::songs::Column::CoverArtHash.is_not_null())
        .order_by_asc(entity::playlist_songs::Column::Position)
        .limit(limit)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows)
}
