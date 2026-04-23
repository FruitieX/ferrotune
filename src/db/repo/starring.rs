//! Starring and rating queries.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, JoinType, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait,
};

use crate::db::entity;
use crate::db::models::ItemType;
use crate::db::retry::with_retry;
use crate::db::Database;
use crate::error::Result;

fn item_type_value(item_type: ItemType) -> String {
    item_type.as_str().to_string()
}

async fn star_item_ids(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
    now: DateTime<Utc>,
) -> Result<()> {
    if item_ids.is_empty() {
        return Ok(());
    }

    let item_type_value = item_type_value(item_type);
    let models = item_ids
        .iter()
        .cloned()
        .map(|item_id| entity::starred::ActiveModel {
            user_id: Set(user_id),
            item_type: Set(item_type_value.clone()),
            item_id: Set(item_id),
            starred_at: Set(now.fixed_offset()),
        })
        .collect::<Vec<_>>();

    with_retry(
        || async {
            entity::starred::Entity::insert_many(models.clone())
                .on_conflict_do_nothing()
                .exec(database.conn())
                .await
                .map(|_| ())
        },
        None,
    )
    .await?;

    Ok(())
}

async fn unstar_item_ids(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> Result<()> {
    if item_ids.is_empty() {
        return Ok(());
    }

    let item_type_value = item_type_value(item_type);
    let item_ids = item_ids.to_vec();

    with_retry(
        || async {
            entity::starred::Entity::delete_many()
                .filter(entity::starred::Column::UserId.eq(user_id))
                .filter(entity::starred::Column::ItemType.eq(item_type_value.clone()))
                .filter(entity::starred::Column::ItemId.is_in(item_ids.clone()))
                .exec(database.conn())
                .await
                .map(|_| ())
        },
        None,
    )
    .await?;

    Ok(())
}

pub async fn get_starred_map(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> Result<HashMap<String, String>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = entity::starred::Entity::find()
        .filter(entity::starred::Column::UserId.eq(user_id))
        .filter(entity::starred::Column::ItemType.eq(item_type_value(item_type)))
        .filter(entity::starred::Column::ItemId.is_in(item_ids.iter().cloned()))
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.item_id,
                crate::api::common::utils::format_datetime_iso(row.starred_at.with_timezone(&Utc)),
            )
        })
        .collect())
}

pub async fn get_ratings_map(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> Result<HashMap<String, i32>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = entity::ratings::Entity::find()
        .filter(entity::ratings::Column::UserId.eq(user_id))
        .filter(entity::ratings::Column::ItemType.eq(item_type_value(item_type)))
        .filter(entity::ratings::Column::ItemId.is_in(item_ids.iter().cloned()))
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.item_id, row.rating))
        .collect())
}

pub async fn star_items(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> Result<()> {
    let now = Utc::now();
    star_item_ids(database, user_id, ItemType::Song, song_ids, now).await?;
    star_item_ids(database, user_id, ItemType::Album, album_ids, now).await?;
    star_item_ids(database, user_id, ItemType::Artist, artist_ids, now).await?;
    Ok(())
}

pub async fn unstar_items(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> Result<()> {
    unstar_item_ids(database, user_id, ItemType::Song, song_ids).await?;
    unstar_item_ids(database, user_id, ItemType::Album, album_ids).await?;
    unstar_item_ids(database, user_id, ItemType::Artist, artist_ids).await?;
    Ok(())
}

pub async fn set_item_rating(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
    id: &str,
    rating: i32,
) -> Result<()> {
    if rating == 0 {
        entity::ratings::Entity::delete_many()
            .filter(entity::ratings::Column::UserId.eq(user_id))
            .filter(entity::ratings::Column::ItemType.eq(item_type_value(item_type)))
            .filter(entity::ratings::Column::ItemId.eq(id))
            .exec(database.conn())
            .await?;
        return Ok(());
    }

    use sea_orm::sea_query::OnConflict;

    let now = Utc::now().fixed_offset();
    let model = entity::ratings::ActiveModel {
        user_id: Set(user_id),
        item_type: Set(item_type_value(item_type)),
        item_id: Set(id.to_string()),
        rating: Set(rating),
        rated_at: Set(now),
    };

    entity::ratings::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                entity::ratings::Column::UserId,
                entity::ratings::Column::ItemType,
                entity::ratings::Column::ItemId,
            ])
            .update_columns([
                entity::ratings::Column::Rating,
                entity::ratings::Column::RatedAt,
            ])
            .to_owned(),
        )
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn list_starred_items(
    database: &Database,
    user_id: i64,
    item_type: ItemType,
) -> Result<Vec<(String, DateTime<Utc>)>> {
    let rows = entity::starred::Entity::find()
        .filter(entity::starred::Column::UserId.eq(user_id))
        .filter(entity::starred::Column::ItemType.eq(item_type_value(item_type)))
        .order_by_desc(entity::starred::Column::StarredAt)
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.item_id, row.starred_at.with_timezone(&Utc)))
        .collect())
}

/// List starred songs for a user restricted to accessible libraries, ordered
/// by most-recently-starred first. Returns `(song_id, starred_at)`.
pub async fn list_starred_accessible_songs(
    database: &Database,
    user_id: i64,
) -> Result<Vec<(String, DateTime<Utc>)>> {
    use entity::starred::Column as ST;

    // Manual relation: starred.item_id -> songs.id (starred rows cover multiple
    // item types so there is no entity-level relation).
    let starred_to_song: sea_orm::RelationDef =
        entity::starred::Entity::belongs_to(entity::songs::Entity)
            .from(entity::starred::Column::ItemId)
            .to(entity::songs::Column::Id)
            .into();

    let rows: Vec<(String, DateTime<Utc>)> = entity::starred::Entity::find()
        .select_only()
        .column(ST::ItemId)
        .column(ST::StarredAt)
        .join(JoinType::InnerJoin, starred_to_song)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(ST::UserId.eq(user_id))
        .filter(ST::ItemType.eq("song"))
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .order_by_desc(ST::StarredAt)
        .into_tuple()
        .all(database.conn())
        .await?;

    Ok(rows)
}

/// Aggregate per-song play stats (play count + last played) for the given
/// user. Only submission scrobbles count.
pub async fn batch_song_play_stats(
    database: &Database,
    user_id: i64,
    song_ids: &[String],
) -> Result<HashMap<String, (i64, DateTime<Utc>)>> {
    if song_ids.is_empty() {
        return Ok(HashMap::new());
    }
    use entity::scrobbles::Column as S;
    let rows: Vec<(String, i64, DateTime<Utc>)> = entity::scrobbles::Entity::find()
        .select_only()
        .column(S::SongId)
        .expr_as(S::Id.count(), "play_count")
        .expr_as(S::PlayedAt.max(), "last_played")
        .filter(S::Submission.eq(true))
        .filter(S::UserId.eq(user_id))
        .filter(S::SongId.is_in(song_ids.iter().cloned()))
        .group_by(S::SongId)
        .into_tuple()
        .all(database.conn())
        .await?;
    Ok(rows
        .into_iter()
        .map(|(id, count, last)| (id, (count, last)))
        .collect())
}
