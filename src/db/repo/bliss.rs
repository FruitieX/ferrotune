//! Bliss similarity query helpers.

use sea_orm::sea_query::{Expr, IntoCondition};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, JoinType, QueryFilter, QuerySelect,
    RelationTrait,
};

use crate::db::entity;
use crate::error::Result;

#[derive(FromQueryResult)]
pub struct BlissSeedRow {
    pub bliss_features: Vec<u8>,
    pub title: String,
    pub artist_id: String,
}

#[derive(FromQueryResult)]
pub struct BlissCandidateRow {
    pub id: String,
    pub bliss_features: Vec<u8>,
    pub title: String,
    pub artist_id: String,
}

/// Fetch the bliss seed song row, gated by enabled music folder + user access.
pub async fn fetch_seed<C: ConnectionTrait>(
    conn: &C,
    seed_song_id: &str,
    user_id: i64,
) -> Result<Option<BlissSeedRow>> {
    use entity::songs::Column as S;
    let row = entity::songs::Entity::find()
        .select_only()
        .column(S::BlissFeatures)
        .column(S::Title)
        .column(S::ArtistId)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .filter(S::Id.eq(seed_song_id))
        .filter(S::BlissFeatures.is_not_null())
        .filter(S::MarkedForDeletionAt.is_null())
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .into_model::<BlissSeedRow>()
        .one(conn)
        .await?;
    Ok(row)
}

/// Fetch every analysed candidate song (with bliss features) visible to the
/// user, excluding the seed and any song the user has disabled.
pub async fn fetch_candidates<C: ConnectionTrait>(
    conn: &C,
    seed_song_id: &str,
    user_id: i64,
) -> Result<Vec<BlissCandidateRow>> {
    use entity::songs::Column as S;

    // LEFT JOIN disabled_songs ON ds.song_id = s.id AND ds.user_id = $user
    let disabled_join =
        entity::songs::Relation::DisabledSongs
            .def()
            .on_condition(move |_left, right| {
                Expr::col((right, entity::disabled_songs::Column::UserId))
                    .eq(user_id)
                    .into_condition()
            });

    let rows = entity::songs::Entity::find()
        .select_only()
        .column(S::Id)
        .column(S::BlissFeatures)
        .column(S::Title)
        .column(S::ArtistId)
        .join(
            JoinType::InnerJoin,
            entity::songs::Relation::MusicFolders.def(),
        )
        .join(
            JoinType::InnerJoin,
            entity::music_folders::Relation::UserLibraryAccess.def(),
        )
        .join(JoinType::LeftJoin, disabled_join)
        .filter(S::BlissFeatures.is_not_null())
        .filter(S::Id.ne(seed_song_id))
        .filter(S::MarkedForDeletionAt.is_null())
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .filter(entity::disabled_songs::Column::Id.is_null())
        .into_model::<BlissCandidateRow>()
        .all(conn)
        .await?;
    Ok(rows)
}
