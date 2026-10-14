//! Native app installs registered for push wake-ups (Firebase Cloud Messaging).

use chrono::Utc;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

use crate::db::entity;
use crate::db::Database;
use crate::error::Result;

pub use entity::push_devices::Model as PushDevice;

/// Registers (or refreshes) a client's push token for a user.
pub async fn upsert_push_device(
    database: &Database,
    user_id: i64,
    client_id: &str,
    client_name: &str,
    device_label: Option<&str>,
    token: &str,
) -> Result<()> {
    use entity::push_devices::Column as C;

    let model = entity::push_devices::ActiveModel {
        user_id: Set(user_id),
        client_id: Set(client_id.to_string()),
        client_name: Set(client_name.to_string()),
        device_label: Set(device_label.map(str::to_string)),
        token: Set(token.to_string()),
        updated_at: Set(Utc::now().fixed_offset()),
        ..Default::default()
    };

    entity::push_devices::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([C::UserId, C::ClientId])
                .update_columns([C::ClientName, C::DeviceLabel, C::Token, C::UpdatedAt])
                .to_owned(),
        )
        .exec(database.conn())
        .await?;
    Ok(())
}

/// Removes a client's registration; returns whether one existed.
pub async fn delete_push_device(
    database: &Database,
    user_id: i64,
    client_id: &str,
) -> Result<bool> {
    use entity::push_devices::Column as C;
    let result = entity::push_devices::Entity::delete_many()
        .filter(C::UserId.eq(user_id))
        .filter(C::ClientId.eq(client_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

/// Removes every registration using a token FCM no longer accepts.
pub async fn delete_push_devices_with_token(database: &Database, token: &str) -> Result<()> {
    use entity::push_devices::Column as C;
    entity::push_devices::Entity::delete_many()
        .filter(C::Token.eq(token))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn get_push_device(
    database: &Database,
    user_id: i64,
    client_id: &str,
) -> Result<Option<PushDevice>> {
    use entity::push_devices::Column as C;
    Ok(entity::push_devices::Entity::find()
        .filter(C::UserId.eq(user_id))
        .filter(C::ClientId.eq(client_id))
        .one(database.conn())
        .await?)
}

pub async fn list_push_devices(database: &Database, user_id: i64) -> Result<Vec<PushDevice>> {
    use entity::push_devices::Column as C;
    Ok(entity::push_devices::Entity::find()
        .filter(C::UserId.eq(user_id))
        .order_by_desc(C::UpdatedAt)
        .all(database.conn())
        .await?)
}
