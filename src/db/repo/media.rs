//! SeaORM-backed helpers for reading song file paths + folder metadata,
//! used by the media (streaming/download/delete) endpoints.

use sea_orm::{EntityTrait, FromQueryResult, JoinType, QuerySelect, RelationTrait};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

/// Song + owning music folder path.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SongWithFolderPath {
    pub file_path: String,
    pub folder_path: String,
}

/// Look up a song's relative file path alongside its music folder's absolute
/// path. Returns `None` when the song does not exist.
pub async fn get_song_with_folder_path(
    database: &Database,
    song_id: &str,
) -> Result<Option<SongWithFolderPath>> {
    entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::FilePath)
        .column_as(entity::music_folders::Column::Path, "folder_path")
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .into_model::<SongWithFolderPath>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}

/// Minimal song metadata suitable for scrobble submissions to Last.fm.
#[derive(Debug, Clone, FromQueryResult)]
pub struct SongScrobbleMetadata {
    pub title: String,
    pub name: String,
    pub album_name: Option<String>,
    pub duration: Option<i64>,
}

/// Fetch title/artist/album/duration metadata for a song, joining artist
/// and album. Returns `None` when the song does not exist.
pub async fn get_song_scrobble_metadata(
    database: &Database,
    song_id: &str,
) -> Result<Option<SongScrobbleMetadata>> {
    entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::Title)
        .column_as(entity::artists::Column::Name, "name")
        .column_as(entity::albums::Column::Name, "album_name")
        .column_as(entity::songs::Column::Duration, "duration")
        .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
        .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
        .into_model::<SongScrobbleMetadata>()
        .one(database.conn())
        .await
        .map_err(Into::into)
}
