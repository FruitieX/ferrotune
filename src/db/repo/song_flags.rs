//! Song flag queries for disabled songs and shuffle excludes.

use chrono::Utc;
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

pub async fn is_song_disabled(database: &Database, user_id: i64, song_id: &str) -> Result<bool> {
    let row = entity::disabled_songs::Entity::find()
        .select_only()
        .column(entity::disabled_songs::Column::Id)
        .filter(entity::disabled_songs::Column::UserId.eq(user_id))
        .filter(entity::disabled_songs::Column::SongId.eq(song_id))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(row.is_some())
}

pub async fn set_song_disabled(
    database: &Database,
    user_id: i64,
    song_id: &str,
    disabled: bool,
) -> Result<()> {
    if disabled {
        use sea_orm::sea_query::OnConflict;

        let model = entity::disabled_songs::ActiveModel {
            user_id: Set(user_id),
            song_id: Set(song_id.to_string()),
            created_at: Set(Utc::now().fixed_offset()),
            ..Default::default()
        };

        entity::disabled_songs::Entity::insert(model)
            .on_conflict(
                OnConflict::columns([
                    entity::disabled_songs::Column::UserId,
                    entity::disabled_songs::Column::SongId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(database.conn())
            .await?;
    } else {
        entity::disabled_songs::Entity::delete_many()
            .filter(entity::disabled_songs::Column::UserId.eq(user_id))
            .filter(entity::disabled_songs::Column::SongId.eq(song_id))
            .exec(database.conn())
            .await?;
    }

    Ok(())
}

pub async fn list_disabled_song_ids(database: &Database, user_id: i64) -> Result<Vec<String>> {
    entity::disabled_songs::Entity::find()
        .select_only()
        .column(entity::disabled_songs::Column::SongId)
        .filter(entity::disabled_songs::Column::UserId.eq(user_id))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn bulk_set_disabled(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
    disabled: bool,
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    if disabled {
        use sea_orm::sea_query::OnConflict;

        let models = song_ids
            .iter()
            .map(|song_id| entity::disabled_songs::ActiveModel {
                user_id: Set(user_id),
                song_id: Set(song_id.clone()),
                created_at: Set(Utc::now().fixed_offset()),
                ..Default::default()
            })
            .collect::<Vec<_>>();

        entity::disabled_songs::Entity::insert_many(models)
            .on_conflict(
                OnConflict::columns([
                    entity::disabled_songs::Column::UserId,
                    entity::disabled_songs::Column::SongId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(database.conn())
            .await?;
    } else {
        entity::disabled_songs::Entity::delete_many()
            .filter(entity::disabled_songs::Column::UserId.eq(user_id))
            .filter(entity::disabled_songs::Column::SongId.is_in(song_ids.iter().cloned()))
            .exec(database.conn())
            .await?;
    }

    Ok(())
}

pub async fn is_song_shuffle_excluded(
    database: &Database,
    user_id: i64,
    song_id: &str,
) -> Result<bool> {
    let row = entity::shuffle_excludes::Entity::find()
        .select_only()
        .column(entity::shuffle_excludes::Column::Id)
        .filter(entity::shuffle_excludes::Column::UserId.eq(user_id))
        .filter(entity::shuffle_excludes::Column::SongId.eq(song_id))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(row.is_some())
}

pub async fn set_song_shuffle_excluded(
    database: &Database,
    user_id: i64,
    song_id: &str,
    excluded: bool,
) -> Result<()> {
    if excluded {
        use sea_orm::sea_query::OnConflict;

        let model = entity::shuffle_excludes::ActiveModel {
            user_id: Set(user_id),
            song_id: Set(song_id.to_string()),
            created_at: Set(Utc::now().fixed_offset()),
            ..Default::default()
        };

        entity::shuffle_excludes::Entity::insert(model)
            .on_conflict(
                OnConflict::columns([
                    entity::shuffle_excludes::Column::UserId,
                    entity::shuffle_excludes::Column::SongId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(database.conn())
            .await?;
    } else {
        entity::shuffle_excludes::Entity::delete_many()
            .filter(entity::shuffle_excludes::Column::UserId.eq(user_id))
            .filter(entity::shuffle_excludes::Column::SongId.eq(song_id))
            .exec(database.conn())
            .await?;
    }

    Ok(())
}

pub async fn list_shuffle_excluded_song_ids(
    database: &Database,
    user_id: i64,
) -> Result<Vec<String>> {
    entity::shuffle_excludes::Entity::find()
        .select_only()
        .column(entity::shuffle_excludes::Column::SongId)
        .filter(entity::shuffle_excludes::Column::UserId.eq(user_id))
        .into_tuple::<String>()
        .all(database.conn())
        .await
        .map_err(Into::into)
}

pub async fn bulk_set_shuffle_excluded(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
    excluded: bool,
) -> Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    if excluded {
        use sea_orm::sea_query::OnConflict;

        let models = song_ids
            .iter()
            .map(|song_id| entity::shuffle_excludes::ActiveModel {
                user_id: Set(user_id),
                song_id: Set(song_id.clone()),
                created_at: Set(Utc::now().fixed_offset()),
                ..Default::default()
            })
            .collect::<Vec<_>>();

        entity::shuffle_excludes::Entity::insert_many(models)
            .on_conflict(
                OnConflict::columns([
                    entity::shuffle_excludes::Column::UserId,
                    entity::shuffle_excludes::Column::SongId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(database.conn())
            .await?;
    } else {
        entity::shuffle_excludes::Entity::delete_many()
            .filter(entity::shuffle_excludes::Column::UserId.eq(user_id))
            .filter(entity::shuffle_excludes::Column::SongId.is_in(song_ids.iter().cloned()))
            .exec(database.conn())
            .await?;
    }

    Ok(())
}
