//! Server configuration and setup-status queries.
//!
//! This module centralizes the small key-value configuration table so admin
//! handlers do not need to issue raw SQL for basic reads and upserts.

use std::collections::HashMap;

use chrono::Utc;
use sea_orm::{ActiveValue::Set, EntityTrait};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

pub async fn get_config_value(database: &Database, key: &str) -> Result<Option<String>> {
    let model = entity::server_config::Entity::find_by_id(key.to_string())
        .one(database.conn())
        .await?;
    Ok(model.map(|row| row.value))
}

pub async fn set_config_value(database: &Database, key: &str, value: &str) -> Result<()> {
    use sea_orm::sea_query::OnConflict;

    let model = entity::server_config::ActiveModel {
        key: Set(key.to_string()),
        value: Set(value.to_string()),
        updated_at: Set(Utc::now().fixed_offset()),
    };

    entity::server_config::Entity::insert(model)
        .on_conflict(
            OnConflict::column(entity::server_config::Column::Key)
                .update_columns([
                    entity::server_config::Column::Value,
                    entity::server_config::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn get_all_config_values(database: &Database) -> Result<HashMap<String, String>> {
    let rows = entity::server_config::Entity::find()
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.key, row.value))
        .collect::<HashMap<_, _>>())
}

pub async fn is_initial_setup_complete(database: &Database) -> Result<bool> {
    Ok(get_config_value(database, "initial_setup_complete")
        .await?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or(false))
}

pub async fn set_initial_setup_complete(database: &Database, configured: bool) -> Result<()> {
    set_config_value(database, "initial_setup_complete", &configured.to_string()).await
}
