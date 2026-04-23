//! Tagger repository queries.
//!
//! Helpers for the tagger API that were previously raw SQL.

use sea_orm::{
    ColumnTrait, EntityTrait, JoinType, QueryFilter, QueryOrder, QuerySelect, RelationTrait,
};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

/// Fetch the cover art filename for a pending edit, if any.
pub async fn get_pending_edit_cover_filename(
    database: &Database,
    session_id: i64,
    track_id: &str,
) -> Result<Option<String>> {
    let row: Option<Option<String>> = entity::tagger_pending_edits::Entity::find()
        .select_only()
        .column(entity::tagger_pending_edits::Column::CoverArtFilename)
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .filter(entity::tagger_pending_edits::Column::TrackId.eq(track_id))
        .into_tuple::<Option<String>>()
        .one(database.conn())
        .await?;
    Ok(row.flatten())
}

/// Delete a pending edit row for `(session_id, track_id)`.
pub async fn delete_pending_edit(
    database: &Database,
    session_id: i64,
    track_id: &str,
) -> Result<()> {
    entity::tagger_pending_edits::Entity::delete_many()
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .filter(entity::tagger_pending_edits::Column::TrackId.eq(track_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Remove a track from a tagger session.
pub async fn delete_session_track(
    database: &Database,
    session_id: i64,
    track_id: &str,
) -> Result<()> {
    entity::tagger_session_tracks::Entity::delete_many()
        .filter(entity::tagger_session_tracks::Column::SessionId.eq(session_id))
        .filter(entity::tagger_session_tracks::Column::TrackId.eq(track_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Row returned by [`list_song_paths`]. Mirrors the joined metadata projection
/// used by the `GET /ferrotune/tagger/song-paths` endpoint.
#[derive(Debug, Clone, sea_orm::FromQueryResult)]
pub struct SongPathRow {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist_name: String,
    pub file_format: String,
    pub album_name: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: i32,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub album_artist_name: Option<String>,
}

/// List lightweight metadata for every non-disabled song ordered by file path.
pub async fn list_song_paths(database: &Database) -> Result<Vec<SongPathRow>> {
    use sea_orm::sea_query::{Alias, Expr, Query};

    let mut q = entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .column(entity::songs::Column::FilePath)
        .column(entity::songs::Column::Title)
        .column_as(entity::artists::Column::Name, "artist_name")
        .column(entity::songs::Column::FileFormat)
        .column_as(entity::albums::Column::Name, "album_name")
        .column(entity::songs::Column::TrackNumber)
        .column(entity::songs::Column::DiscNumber)
        .column(entity::songs::Column::Year)
        .column(entity::songs::Column::Genre)
        .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def());

    // Second artists join (as "aa") for album artist name. SeaORM's Relation
    // definitions only cover the single songs.artist_id -> artists.id mapping,
    // so compose an explicit join expression here for albums.artist_id.
    let aa = Alias::new("aa");
    q = q
        .join_as(
            JoinType::LeftJoin,
            entity::albums::Relation::Artists.def(),
            aa.clone(),
        )
        .column_as(
            Expr::col((aa.clone(), entity::artists::Column::Name)),
            "album_artist_name",
        );

    // Exclude songs that are disabled. Using NOT IN (SELECT song_id FROM
    // disabled_songs) avoids constructing a correlated NOT EXISTS subquery
    // via SeaORM's query-builder (which has no public `not_exists`).
    let disabled_subquery = Query::select()
        .column(entity::disabled_songs::Column::SongId)
        .from(entity::disabled_songs::Entity)
        .to_owned();

    q = q
        .filter(
            Expr::col((entity::songs::Entity, entity::songs::Column::Id))
                .not_in_subquery(disabled_subquery),
        )
        .order_by_asc(entity::songs::Column::FilePath);

    q.into_model::<SongPathRow>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}
