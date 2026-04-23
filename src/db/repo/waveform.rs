//! SeaORM-backed pre-computed waveform data lookups.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

/// Fetch the pre-computed waveform blob for a song, or `None` if the song
/// has no waveform yet (or the id doesn't exist).
pub async fn get_waveform_blob(database: &Database, song_id: &str) -> Result<Option<Vec<u8>>> {
    let row: Option<Option<Vec<u8>>> = entity::songs::Entity::find_by_id(song_id.to_string())
        .select_only()
        .column(entity::songs::Column::WaveformData)
        .filter(entity::songs::Column::WaveformData.is_not_null())
        .into_tuple()
        .one(database.conn())
        .await?;

    Ok(row.and_then(|v| v))
}
