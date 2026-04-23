//! Query surface for the library scanner.
//!
//! Groups together read + mutation helpers that the scanner (`src/scanner.rs`)
//! invoked via raw SQL before the SeaORM migration. Each helper accepts a
//! generic `&C: ConnectionTrait` so it works against either a
//! `DatabaseConnection` pool or an in-progress `DatabaseTransaction`.

use crate::db::{entity, models::MusicFolder, Database};
use crate::error::Result;
use sea_orm::sea_query::{
    Expr, ExprTrait, Func, Query, SelectStatement, SimpleExpr, SubQueryStatement,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect,
};

/// Wrap a `SelectStatement` as a scalar subquery `SimpleExpr` suitable for
/// use in `col_expr` / `expr_as` / WHERE clauses.
fn scalar_subquery(stmt: SelectStatement) -> SimpleExpr {
    SimpleExpr::SubQuery(None, Box::new(SubQueryStatement::SelectStatement(stmt)))
}

// ---------------------------------------------------------------------------
// Folder lookups
// ---------------------------------------------------------------------------

/// Fetch an enabled music folder by id, returning `None` if it is disabled or
/// does not exist.
pub async fn get_enabled_music_folder(database: &Database, id: i64) -> Result<Option<MusicFolder>> {
    let row = entity::music_folders::Entity::find_by_id(id)
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .one(database.conn())
        .await?;
    Ok(row.map(MusicFolder::from))
}

/// Look up a music folder's base filesystem path by id.
pub async fn get_music_folder_path<C>(conn: &C, id: i64) -> Result<Option<String>>
where
    C: ConnectionTrait,
{
    let row = entity::music_folders::Entity::find_by_id(id)
        .select_only()
        .column(entity::music_folders::Column::Path)
        .into_tuple::<String>()
        .one(conn)
        .await?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Existing song listings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct ExistingSongPathRow {
    pub id: String,
    pub file_path: String,
    pub file_mtime: Option<i64>,
    pub has_rg: i32,
    pub has_bliss: i32,
    pub has_waveform: i32,
}

/// Load `(id, file_path, mtime, analyzer-status flags)` for every song in a
/// music folder. Used during incremental scans to decide which files can be
/// skipped.
pub async fn list_existing_song_paths_for_folder<C>(
    conn: &C,
    folder_id: i64,
) -> Result<Vec<ExistingSongPathRow>>
where
    C: ConnectionTrait,
{
    use entity::songs::Column as S;

    let rg_expr = Expr::case(S::ComputedReplaygainTrackGain.is_not_null(), 1).finally(0);
    let bliss_expr = Expr::case(S::BlissFeatures.is_not_null(), 1).finally(0);
    let waveform_expr = Expr::case(S::WaveformData.is_not_null(), 1).finally(0);

    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::Id)
        .column(S::FilePath)
        .column(S::FileMtime)
        .expr_as(rg_expr, "has_rg")
        .expr_as(bliss_expr, "has_bliss")
        .expr_as(waveform_expr, "has_waveform")
        .filter(S::MusicFolderId.eq(folder_id))
        .into_model::<ExistingSongPathRow>()
        .all(conn)
        .await?;

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Song deletions
// ---------------------------------------------------------------------------

/// Delete a song by `(file_path, music_folder_id)`. Returns `true` if a row
/// was removed.
pub async fn delete_song_by_path<C>(conn: &C, file_path: &str, folder_id: i64) -> Result<bool>
where
    C: ConnectionTrait,
{
    let res = entity::songs::Entity::delete_many()
        .filter(entity::songs::Column::FilePath.eq(file_path))
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Delete a song by id.
pub async fn delete_song_by_id<C>(conn: &C, song_id: &str) -> Result<u64>
where
    C: ConnectionTrait,
{
    let res = entity::songs::Entity::delete_many()
        .filter(entity::songs::Column::Id.eq(song_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------------------
// Hash + rename helpers
// ---------------------------------------------------------------------------

/// Fetch `partial_hash` for a given song id.
pub async fn get_partial_hash<C>(conn: &C, song_id: &str) -> Result<Option<String>>
where
    C: ConnectionTrait,
{
    let row: Option<(Option<String>,)> = entity::songs::Entity::find_by_id(song_id)
        .select_only()
        .column(entity::songs::Column::PartialHash)
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row.and_then(|(h,)| h))
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct RenameCandidate {
    pub id: String,
    pub file_path: String,
    pub music_folder_id: i64,
}

/// Find a song with a matching `partial_hash` but a different id. Used to
/// detect renames and cross-library moves.
pub async fn find_rename_candidate<C>(
    conn: &C,
    partial_hash: &str,
    exclude_id: &str,
) -> Result<Option<RenameCandidate>>
where
    C: ConnectionTrait,
{
    let row = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::FilePath)
        .column(entity::songs::Column::MusicFolderId)
        .filter(entity::songs::Column::PartialHash.eq(partial_hash))
        .filter(entity::songs::Column::Id.ne(exclude_id))
        .into_model::<RenameCandidate>()
        .one(conn)
        .await?;
    Ok(row)
}

/// Fetch a song's `file_mtime`. Wrapped in an outer `Option` because the row
/// may be missing; the inner `Option` carries the nullable column.
pub async fn get_song_mtime<C>(conn: &C, song_id: &str) -> Result<Option<Option<i64>>>
where
    C: ConnectionTrait,
{
    let row: Option<(Option<i64>,)> = entity::songs::Entity::find_by_id(song_id)
        .select_only()
        .column(entity::songs::Column::FileMtime)
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row.map(|(m,)| m))
}

/// Update a song's filesystem location after a detected rename/move.
pub async fn update_song_location<C>(
    conn: &C,
    song_id: &str,
    new_file_path: &str,
    new_folder_id: i64,
    new_mtime: Option<i64>,
) -> Result<()>
where
    C: ConnectionTrait,
{
    let now = chrono::Utc::now().fixed_offset();
    entity::songs::Entity::update_many()
        .col_expr(entity::songs::Column::FilePath, Expr::value(new_file_path))
        .col_expr(
            entity::songs::Column::MusicFolderId,
            Expr::value(new_folder_id),
        )
        .col_expr(entity::songs::Column::FileMtime, Expr::value(new_mtime))
        .col_expr(entity::songs::Column::UpdatedAt, Expr::value(now))
        .filter(entity::songs::Column::Id.eq(song_id))
        .exec(conn)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Song meta for playlist "missing" entries
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct SongMetaRow {
    pub title: String,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub duration: i64,
}

/// Fetch title + artist/album names + duration for a song. Joins artists and
/// albums (both as LEFT JOIN) so entries without an album still resolve.
pub async fn get_song_meta<C>(conn: &C, song_id: &str) -> Result<Option<SongMetaRow>>
where
    C: ConnectionTrait,
{
    use sea_orm::JoinType;
    use sea_orm::RelationTrait;

    let row = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Title)
        .expr_as(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name)),
            "artist_name",
        )
        .expr_as(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name)),
            "album_name",
        )
        .column(entity::songs::Column::Duration)
        .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .filter(entity::songs::Column::Id.eq(song_id))
        .into_model::<SongMetaRow>()
        .one(conn)
        .await?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Missing-playlist-entry conversion
// ---------------------------------------------------------------------------

/// Convert playlist entries referencing a now-missing song into
/// "missing entry" rows by nulling `song_id` and stashing the metadata blob.
pub async fn convert_playlist_entries_to_missing<C>(
    conn: &C,
    song_id: &str,
    missing_entry_data_json: &str,
    missing_search_text: &str,
) -> Result<()>
where
    C: ConnectionTrait,
{
    entity::playlist_songs::Entity::update_many()
        .col_expr(
            entity::playlist_songs::Column::SongId,
            Expr::value(None::<String>),
        )
        .col_expr(
            entity::playlist_songs::Column::MissingEntryData,
            Expr::value(missing_entry_data_json),
        )
        .col_expr(
            entity::playlist_songs::Column::MissingSearchText,
            Expr::value(missing_search_text),
        )
        .filter(entity::playlist_songs::Column::SongId.eq(song_id))
        .exec(conn)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Aggregate refresh (playlists / albums / artists / orphans)
// ---------------------------------------------------------------------------

/// Refresh every playlist's `song_count`, `duration`, and `updated_at`. Uses
/// correlated subqueries so both dialects can evaluate it in a single UPDATE.
pub async fn refresh_all_playlist_totals<C>(conn: &C) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{playlist_songs as ps, playlists as pl, songs as s};

    // SELECT COUNT(*) FROM playlist_songs
    //   WHERE playlist_id = playlists.id AND song_id IS NOT NULL
    let song_count_sub = Query::select()
        .expr(Expr::col(ps::Column::PlaylistId).count())
        .from(ps::Entity)
        .and_where(
            Expr::col((ps::Entity, ps::Column::PlaylistId)).equals((pl::Entity, pl::Column::Id)),
        )
        .and_where(ps::Column::SongId.is_not_null())
        .to_owned();

    // SELECT COALESCE(SUM(s.duration), 0) FROM songs s
    //   INNER JOIN playlist_songs ps ON s.id = ps.song_id
    //   WHERE ps.playlist_id = playlists.id
    let duration_sub = Query::select()
        .expr(Func::coalesce([
            Expr::col((s::Entity, s::Column::Duration)).sum(),
            Expr::value(0i64),
        ]))
        .from(s::Entity)
        .inner_join(
            ps::Entity,
            Expr::col((s::Entity, s::Column::Id)).equals((ps::Entity, ps::Column::SongId)),
        )
        .and_where(
            Expr::col((ps::Entity, ps::Column::PlaylistId)).equals((pl::Entity, pl::Column::Id)),
        )
        .to_owned();

    pl::Entity::update_many()
        .col_expr(pl::Column::SongCount, scalar_subquery(song_count_sub))
        .col_expr(pl::Column::Duration, scalar_subquery(duration_sub))
        .col_expr(pl::Column::UpdatedAt, Expr::current_timestamp().into())
        .exec(conn)
        .await?;
    Ok(())
}

/// Count albums with no referencing song.
pub async fn count_orphaned_albums<C>(conn: &C) -> Result<i64>
where
    C: ConnectionTrait,
{
    let sub = Query::select()
        .distinct()
        .column(entity::songs::Column::AlbumId)
        .from(entity::songs::Entity)
        .and_where(entity::songs::Column::AlbumId.is_not_null())
        .to_owned();

    let row: Option<i64> = entity::albums::Entity::find()
        .select_only()
        .expr(Expr::col(entity::albums::Column::Id).count())
        .filter(entity::albums::Column::Id.not_in_subquery(sub))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row.unwrap_or(0))
}

/// Remove albums with no referencing song. Returns the number deleted.
pub async fn delete_orphaned_albums<C>(conn: &C) -> Result<u64>
where
    C: ConnectionTrait,
{
    let sub = Query::select()
        .distinct()
        .column(entity::songs::Column::AlbumId)
        .from(entity::songs::Entity)
        .and_where(entity::songs::Column::AlbumId.is_not_null())
        .to_owned();

    let res = entity::albums::Entity::delete_many()
        .filter(entity::albums::Column::Id.not_in_subquery(sub))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Count artists with no referencing song or album.
pub async fn count_orphaned_artists<C>(conn: &C) -> Result<i64>
where
    C: ConnectionTrait,
{
    let songs_sub = Query::select()
        .distinct()
        .column(entity::songs::Column::ArtistId)
        .from(entity::songs::Entity)
        .to_owned();
    let albums_sub = Query::select()
        .distinct()
        .column(entity::albums::Column::ArtistId)
        .from(entity::albums::Entity)
        .to_owned();

    let row: Option<i64> = entity::artists::Entity::find()
        .select_only()
        .expr(Expr::col(entity::artists::Column::Id).count())
        .filter(entity::artists::Column::Id.not_in_subquery(songs_sub))
        .filter(entity::artists::Column::Id.not_in_subquery(albums_sub))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row.unwrap_or(0))
}

/// Remove artists with no referencing song or album. Returns the number
/// deleted.
pub async fn delete_orphaned_artists<C>(conn: &C) -> Result<u64>
where
    C: ConnectionTrait,
{
    let songs_sub = Query::select()
        .distinct()
        .column(entity::songs::Column::ArtistId)
        .from(entity::songs::Entity)
        .to_owned();
    let albums_sub = Query::select()
        .distinct()
        .column(entity::albums::Column::ArtistId)
        .from(entity::albums::Entity)
        .to_owned();

    let res = entity::artists::Entity::delete_many()
        .filter(entity::artists::Column::Id.not_in_subquery(songs_sub))
        .filter(entity::artists::Column::Id.not_in_subquery(albums_sub))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Refresh every album's `song_count` and `duration` from the underlying
/// songs table.
pub async fn refresh_all_album_totals<C>(conn: &C) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{albums as al, songs as s};

    let song_count_sub = Query::select()
        .expr(Expr::col(s::Column::Id).count())
        .from(s::Entity)
        .and_where(Expr::col((s::Entity, s::Column::AlbumId)).equals((al::Entity, al::Column::Id)))
        .to_owned();

    let duration_sub = Query::select()
        .expr(Func::coalesce([
            Expr::col((s::Entity, s::Column::Duration)).sum(),
            Expr::value(0i64),
        ]))
        .from(s::Entity)
        .and_where(Expr::col((s::Entity, s::Column::AlbumId)).equals((al::Entity, al::Column::Id)))
        .to_owned();

    al::Entity::update_many()
        .col_expr(al::Column::SongCount, scalar_subquery(song_count_sub))
        .col_expr(al::Column::Duration, scalar_subquery(duration_sub))
        .exec(conn)
        .await?;
    Ok(())
}

/// Refresh every artist's `album_count` and `song_count` from the underlying
/// songs table.
pub async fn refresh_all_artist_totals<C>(conn: &C) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{artists as ar, songs as s};

    // COUNT(DISTINCT album_id) FROM songs WHERE artist_id = artists.id AND album_id IS NOT NULL
    let album_count_sub = Query::select()
        .expr(Expr::col(s::Column::AlbumId).count_distinct())
        .from(s::Entity)
        .and_where(Expr::col((s::Entity, s::Column::ArtistId)).equals((ar::Entity, ar::Column::Id)))
        .and_where(s::Column::AlbumId.is_not_null())
        .to_owned();

    let song_count_sub = Query::select()
        .expr(Expr::col(s::Column::Id).count())
        .from(s::Entity)
        .and_where(Expr::col((s::Entity, s::Column::ArtistId)).equals((ar::Entity, ar::Column::Id)))
        .to_owned();

    ar::Entity::update_many()
        .col_expr(ar::Column::AlbumCount, scalar_subquery(album_count_sub))
        .col_expr(ar::Column::SongCount, scalar_subquery(song_count_sub))
        .exec(conn)
        .await?;
    Ok(())
}

/// Refresh a single album's `song_count` and `duration`.
pub async fn refresh_album_totals<C>(conn: &C, album_id: &str) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{albums as al, songs as s};

    let song_count_sub = Query::select()
        .expr(Expr::col(s::Column::Id).count())
        .from(s::Entity)
        .and_where(s::Column::AlbumId.eq(album_id))
        .to_owned();

    let duration_sub = Query::select()
        .expr(Func::coalesce([
            Expr::col(s::Column::Duration).sum(),
            Expr::value(0i64),
        ]))
        .from(s::Entity)
        .and_where(s::Column::AlbumId.eq(album_id))
        .to_owned();

    al::Entity::update_many()
        .col_expr(al::Column::SongCount, scalar_subquery(song_count_sub))
        .col_expr(al::Column::Duration, scalar_subquery(duration_sub))
        .filter(al::Column::Id.eq(album_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Refresh cover-art hash/dimensions for an album, sourced from the earliest
/// track by (disc, track) ordering.
pub async fn refresh_album_cover_art<C>(conn: &C, album_id: &str) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{albums as al, songs as s};

    // Build a subquery that returns the requested column for the earliest
    // track in this album (ordered by disc/track with COALESCE defaults).
    fn pick(album_id: &str, column: s::Column) -> SelectStatement {
        let disc_order =
            Func::coalesce([Expr::col(s::Column::DiscNumber).into(), Expr::value(1i64)]);
        let track_order =
            Func::coalesce([Expr::col(s::Column::TrackNumber).into(), Expr::value(1i64)]);
        Query::select()
            .column(column)
            .from(s::Entity)
            .and_where(s::Column::AlbumId.eq(album_id))
            .order_by_expr(disc_order.into(), sea_orm::Order::Asc)
            .order_by_expr(track_order.into(), sea_orm::Order::Asc)
            .limit(1)
            .to_owned()
    }

    al::Entity::update_many()
        .col_expr(
            al::Column::CoverArtHash,
            scalar_subquery(pick(album_id, s::Column::CoverArtHash)),
        )
        .col_expr(
            al::Column::CoverArtWidth,
            scalar_subquery(pick(album_id, s::Column::CoverArtWidth)),
        )
        .col_expr(
            al::Column::CoverArtHeight,
            scalar_subquery(pick(album_id, s::Column::CoverArtHeight)),
        )
        .filter(al::Column::Id.eq(album_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Refresh a single artist's `album_count` and `song_count`.
pub async fn refresh_artist_totals<C>(conn: &C, artist_id: &str) -> Result<()>
where
    C: ConnectionTrait,
{
    use entity::{albums as al, artists as ar, songs as s};

    let album_count_sub = Query::select()
        .expr(Expr::col(al::Column::Id).count())
        .from(al::Entity)
        .and_where(al::Column::ArtistId.eq(artist_id))
        .to_owned();

    let song_count_sub = Query::select()
        .expr(Expr::col(s::Column::Id).count())
        .from(s::Entity)
        .and_where(s::Column::ArtistId.eq(artist_id))
        .to_owned();

    ar::Entity::update_many()
        .col_expr(ar::Column::AlbumCount, scalar_subquery(album_count_sub))
        .col_expr(ar::Column::SongCount, scalar_subquery(song_count_sub))
        .filter(ar::Column::Id.eq(artist_id))
        .exec(conn)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Orphan thumbnails
// ---------------------------------------------------------------------------

/// Delete cover-art thumbnails whose hash is no longer referenced by any
/// song, album, or artist. Returns the number deleted.
pub async fn delete_orphaned_thumbnails<C>(conn: &C) -> Result<u64>
where
    C: ConnectionTrait,
{
    use sea_orm::sea_query::UnionType;

    let mut referenced = Query::select()
        .column(entity::songs::Column::CoverArtHash)
        .from(entity::songs::Entity)
        .and_where(entity::songs::Column::CoverArtHash.is_not_null())
        .to_owned();
    let albums = Query::select()
        .column(entity::albums::Column::CoverArtHash)
        .from(entity::albums::Entity)
        .and_where(entity::albums::Column::CoverArtHash.is_not_null())
        .to_owned();
    let artists = Query::select()
        .column(entity::artists::Column::CoverArtHash)
        .from(entity::artists::Entity)
        .and_where(entity::artists::Column::CoverArtHash.is_not_null())
        .to_owned();
    referenced.union(UnionType::Distinct, albums);
    referenced.union(UnionType::Distinct, artists);

    let res = entity::cover_art_thumbnails::Entity::delete_many()
        .filter(entity::cover_art_thumbnails::Column::Hash.not_in_subquery(referenced))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------------------
// Existing-song lookup (upsert path)
// ---------------------------------------------------------------------------

/// Look up a song id by `(file_path, music_folder_id)`, used to decide
/// whether `upsert_song` should INSERT or UPDATE.
pub async fn find_song_id_by_path<C>(
    conn: &C,
    file_path: &str,
    folder_id: i64,
) -> Result<Option<String>>
where
    C: ConnectionTrait,
{
    let row: Option<String> = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::FilePath.eq(file_path))
        .filter(entity::songs::Column::MusicFolderId.eq(folder_id))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Artist / album upserts (get-or-create)
// ---------------------------------------------------------------------------

/// Find an existing artist id whose name matches case-insensitively.
pub async fn find_artist_id_by_name_ci<C>(conn: &C, name: &str) -> Result<Option<String>>
where
    C: ConnectionTrait,
{
    let lowered = name.to_lowercase();
    // `LOWER(name) = LOWER(?)` works on both backends and preserves the
    // original case-insensitive behaviour (previously sqlite used `COLLATE
    // NOCASE`).
    let row: Option<String> = entity::artists::Entity::find()
        .select_only()
        .column(entity::artists::Column::Id)
        .filter(Expr::expr(Func::lower(Expr::col(entity::artists::Column::Name))).eq(lowered))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(row)
}

/// Insert a new artist row with zeroed counts.
pub async fn insert_artist<C>(conn: &C, artist_id: &str, name: &str) -> Result<()>
where
    C: ConnectionTrait,
{
    use sea_orm::ActiveValue;
    entity::artists::ActiveModel {
        id: ActiveValue::Set(artist_id.to_string()),
        name: ActiveValue::Set(name.to_string()),
        album_count: ActiveValue::Set(0),
        song_count: ActiveValue::Set(0),
        ..Default::default()
    }
    .insert(conn)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct AlbumLookupRow {
    pub id: String,
    pub cover_art_hash: Option<String>,
}

/// Find an existing album by `(name, artist_id)` using case-insensitive
/// name matching.
pub async fn find_album_by_name_artist_ci<C>(
    conn: &C,
    name: &str,
    artist_id: &str,
) -> Result<Option<AlbumLookupRow>>
where
    C: ConnectionTrait,
{
    let lowered = name.to_lowercase();
    let row = entity::albums::Entity::find()
        .select_only()
        .column(entity::albums::Column::Id)
        .column(entity::albums::Column::CoverArtHash)
        .filter(Expr::expr(Func::lower(Expr::col(entity::albums::Column::Name))).eq(lowered))
        .filter(entity::albums::Column::ArtistId.eq(artist_id))
        .into_model::<AlbumLookupRow>()
        .one(conn)
        .await?;
    Ok(row)
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct EarliestTrackRow {
    pub disc_number: i32,
    pub track_number: i32,
}

/// Fetch the earliest `(disc_number, track_number)` pair across all songs in
/// an album. Used when deciding whether an incoming track should replace the
/// album's cover art.
pub async fn get_earliest_track_for_album<C>(
    conn: &C,
    album_id: &str,
) -> Result<Option<EarliestTrackRow>>
where
    C: ConnectionTrait,
{
    let disc_expr = Expr::col(entity::songs::Column::DiscNumber).if_null(1);
    let track_expr = Expr::col(entity::songs::Column::TrackNumber).if_null(1);

    let row = entity::songs::Entity::find()
        .select_only()
        .expr_as(disc_expr.clone(), "disc_number")
        .expr_as(track_expr.clone(), "track_number")
        .filter(entity::songs::Column::AlbumId.eq(album_id))
        .order_by_asc(disc_expr)
        .order_by_asc(track_expr)
        .limit(1)
        .into_model::<EarliestTrackRow>()
        .one(conn)
        .await?;
    Ok(row)
}

/// Update just the `cover_art_hash` column of an album.
pub async fn update_album_cover_art_hash<C>(
    conn: &C,
    album_id: &str,
    cover_art_hash: Option<&str>,
) -> Result<()>
where
    C: ConnectionTrait,
{
    entity::albums::Entity::update_many()
        .col_expr(
            entity::albums::Column::CoverArtHash,
            Expr::value(cover_art_hash.map(str::to_string)),
        )
        .filter(entity::albums::Column::Id.eq(album_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Insert a brand-new album row with zeroed counts and optional metadata.
pub async fn insert_album<C>(
    conn: &C,
    album_id: &str,
    name: &str,
    artist_id: &str,
    year: Option<i32>,
    genre: Option<&str>,
    cover_art_hash: Option<&str>,
) -> Result<()>
where
    C: ConnectionTrait,
{
    use sea_orm::ActiveValue;
    entity::albums::ActiveModel {
        id: ActiveValue::Set(album_id.to_string()),
        name: ActiveValue::Set(name.to_string()),
        artist_id: ActiveValue::Set(artist_id.to_string()),
        year: ActiveValue::Set(year),
        genre: ActiveValue::Set(genre.map(str::to_string)),
        cover_art_hash: ActiveValue::Set(cover_art_hash.map(str::to_string)),
        ..Default::default()
    }
    .insert(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Song insert / update
// ---------------------------------------------------------------------------

/// Full metadata payload for inserting or updating a single song.
#[derive(Debug, Clone)]
pub struct SongWritePayload {
    pub title: String,
    pub album_id: Option<String>,
    pub artist_id: String,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: i64,
    pub bitrate: Option<i32>,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    pub music_folder_id: i64,
    pub file_mtime: Option<i64>,
    pub partial_hash: Option<String>,
    pub cover_art_hash: Option<String>,
    pub cover_art_width: Option<i32>,
    pub cover_art_height: Option<i32>,
    pub original_replaygain_track_gain: Option<f64>,
    pub original_replaygain_track_peak: Option<f64>,
    pub computed_replaygain_track_gain: Option<f64>,
    pub computed_replaygain_track_peak: Option<f64>,
    pub bliss_features: Option<Vec<u8>>,
    pub bliss_version: Option<i32>,
    pub waveform_data: Option<Vec<u8>>,
}

/// Update every scanner-populated column on a song. Analyzer-produced fields
/// (`computed_replaygain_*`, `bliss_*`, `waveform_data`) are only written
/// when the payload carries `Some` — existing values are preserved via
/// `ActiveValue::NotSet`. This mirrors the previous `COALESCE(?, column)`
/// behaviour without a dialect-specific SQL string.
pub async fn update_song_row<C>(conn: &C, song_id: &str, payload: &SongWritePayload) -> Result<()>
where
    C: ConnectionTrait,
{
    use sea_orm::ActiveValue;

    let now = chrono::Utc::now().fixed_offset();
    let mut active = entity::songs::ActiveModel {
        id: ActiveValue::Unchanged(song_id.to_string()),
        title: ActiveValue::Set(payload.title.clone()),
        album_id: ActiveValue::Set(payload.album_id.clone()),
        artist_id: ActiveValue::Set(payload.artist_id.clone()),
        track_number: ActiveValue::Set(payload.track_number),
        disc_number: ActiveValue::Set(payload.disc_number),
        year: ActiveValue::Set(payload.year),
        genre: ActiveValue::Set(payload.genre.clone()),
        duration: ActiveValue::Set(payload.duration),
        bitrate: ActiveValue::Set(payload.bitrate),
        file_size: ActiveValue::Set(payload.file_size),
        file_format: ActiveValue::Set(payload.file_format.clone()),
        music_folder_id: ActiveValue::Set(Some(payload.music_folder_id)),
        file_mtime: ActiveValue::Set(payload.file_mtime),
        partial_hash: ActiveValue::Set(payload.partial_hash.clone()),
        cover_art_hash: ActiveValue::Set(payload.cover_art_hash.clone()),
        cover_art_width: ActiveValue::Set(payload.cover_art_width),
        cover_art_height: ActiveValue::Set(payload.cover_art_height),
        original_replaygain_track_gain: ActiveValue::Set(payload.original_replaygain_track_gain),
        original_replaygain_track_peak: ActiveValue::Set(payload.original_replaygain_track_peak),
        full_file_hash: ActiveValue::Set(None),
        updated_at: ActiveValue::Set(now),
        bliss_version: ActiveValue::NotSet,
        ..Default::default()
    };

    // Analyzer-produced fields: only overwrite when Some.
    if let Some(gain) = payload.computed_replaygain_track_gain {
        active.computed_replaygain_track_gain = ActiveValue::Set(Some(gain));
    }
    if let Some(peak) = payload.computed_replaygain_track_peak {
        active.computed_replaygain_track_peak = ActiveValue::Set(Some(peak));
    }
    if let Some(ref bliss) = payload.bliss_features {
        active.bliss_features = ActiveValue::Set(Some(bliss.clone()));
    }
    if payload.bliss_version.is_some() {
        active.bliss_version = ActiveValue::Set(payload.bliss_version);
    }
    if let Some(ref waveform) = payload.waveform_data {
        active.waveform_data = ActiveValue::Set(Some(waveform.clone()));
    }

    entity::songs::Entity::update(active).exec(conn).await?;
    Ok(())
}

/// Insert a new song row generated by the scanner.
pub async fn insert_song_row<C>(conn: &C, song_id: &str, payload: &SongWritePayload) -> Result<()>
where
    C: ConnectionTrait,
{
    use sea_orm::ActiveValue;

    let now = chrono::Utc::now().fixed_offset();
    entity::songs::ActiveModel {
        id: ActiveValue::Set(song_id.to_string()),
        title: ActiveValue::Set(payload.title.clone()),
        album_id: ActiveValue::Set(payload.album_id.clone()),
        artist_id: ActiveValue::Set(payload.artist_id.clone()),
        track_number: ActiveValue::Set(payload.track_number),
        disc_number: ActiveValue::Set(payload.disc_number),
        year: ActiveValue::Set(payload.year),
        genre: ActiveValue::Set(payload.genre.clone()),
        duration: ActiveValue::Set(payload.duration),
        bitrate: ActiveValue::Set(payload.bitrate),
        file_path: ActiveValue::Set(payload.file_path.clone()),
        file_size: ActiveValue::Set(payload.file_size),
        file_format: ActiveValue::Set(payload.file_format.clone()),
        music_folder_id: ActiveValue::Set(Some(payload.music_folder_id)),
        file_mtime: ActiveValue::Set(payload.file_mtime),
        partial_hash: ActiveValue::Set(payload.partial_hash.clone()),
        cover_art_hash: ActiveValue::Set(payload.cover_art_hash.clone()),
        cover_art_width: ActiveValue::Set(payload.cover_art_width),
        cover_art_height: ActiveValue::Set(payload.cover_art_height),
        original_replaygain_track_gain: ActiveValue::Set(payload.original_replaygain_track_gain),
        original_replaygain_track_peak: ActiveValue::Set(payload.original_replaygain_track_peak),
        computed_replaygain_track_gain: ActiveValue::Set(payload.computed_replaygain_track_gain),
        computed_replaygain_track_peak: ActiveValue::Set(payload.computed_replaygain_track_peak),
        bliss_features: ActiveValue::Set(payload.bliss_features.clone()),
        bliss_version: ActiveValue::Set(payload.bliss_version),
        waveform_data: ActiveValue::Set(payload.waveform_data.clone()),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        full_file_hash: ActiveValue::Set(None),
        marked_for_deletion_at: ActiveValue::Set(None),
    }
    .insert(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct PartialHashCollision {
    pub partial_hash: String,
    pub cnt: i64,
}

/// Find partial-hash values that appear on more than one song.
pub async fn list_partial_hash_collisions<C>(conn: &C) -> Result<Vec<PartialHashCollision>>
where
    C: ConnectionTrait,
{
    use entity::songs::Column as S;
    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::PartialHash)
        .expr_as(Expr::col(S::Id).count(), "cnt")
        .filter(S::PartialHash.is_not_null())
        .group_by(S::PartialHash)
        .having(Expr::col(S::Id).count().gt(1))
        .into_model::<PartialHashCollision>()
        .all(conn)
        .await?;
    Ok(rows)
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct DuplicateSongRow {
    pub id: String,
    pub file_path: String,
    pub music_folder_id: i64,
    pub file_size: i64,
    pub full_file_hash: Option<String>,
}

/// List all songs sharing a given `partial_hash`.
pub async fn list_songs_by_partial_hash<C>(
    conn: &C,
    partial_hash: &str,
) -> Result<Vec<DuplicateSongRow>>
where
    C: ConnectionTrait,
{
    use entity::songs::Column as S;
    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::Id)
        .column(S::FilePath)
        .column(S::MusicFolderId)
        .column(S::FileSize)
        .column(S::FullFileHash)
        .filter(S::PartialHash.eq(partial_hash))
        .into_model::<DuplicateSongRow>()
        .all(conn)
        .await?;
    Ok(rows)
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct DryRunSongRow {
    pub file_path: String,
    pub file_size: i64,
}

/// Dry-run variant: list just `(file_path, file_size)` for songs with a given
/// partial hash.
pub async fn list_dry_run_songs_by_partial_hash<C>(
    conn: &C,
    partial_hash: &str,
) -> Result<Vec<DryRunSongRow>>
where
    C: ConnectionTrait,
{
    use entity::songs::Column as S;
    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::FilePath)
        .column(S::FileSize)
        .filter(S::PartialHash.eq(partial_hash))
        .into_model::<DryRunSongRow>()
        .all(conn)
        .await?;
    Ok(rows)
}

/// Set `full_file_hash` for a song.
pub async fn set_full_file_hash<C>(conn: &C, song_id: &str, full_hash: &str) -> Result<()>
where
    C: ConnectionTrait,
{
    entity::songs::Entity::update_many()
        .col_expr(
            entity::songs::Column::FullFileHash,
            Expr::value(Some(full_hash.to_string())),
        )
        .filter(entity::songs::Column::Id.eq(song_id))
        .exec(conn)
        .await?;
    Ok(())
}
