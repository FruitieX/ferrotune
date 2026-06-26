//! `SeaORM` Entity for playback_starts table.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "playback_starts")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub user_id: i64,
    #[sea_orm(column_type = "Text")]
    pub song_id: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub session_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub source_type: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub source_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub client_name: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub trigger_type: Option<String>,
    pub started_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::songs::Entity",
        from = "Column::SongId",
        to = "super::songs::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Songs,
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Users,
    #[sea_orm(
        belongs_to = "super::playback_sessions::Entity",
        from = "Column::SessionId",
        to = "super::playback_sessions::Column::Id",
        on_update = "NoAction",
        on_delete = "SetNull"
    )]
    PlaybackSessions,
}

impl Related<super::songs::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Songs.def()
    }
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

impl Related<super::playback_sessions::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PlaybackSessions.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
