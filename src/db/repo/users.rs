//! User, API-key, user-preference, music-folder and library-access queries.
//!
//! This module is the SeaORM replacement for the corresponding functions in
//! `src/db/queries.rs`. Each function accepts a [`Database`] handle and
//! dispatches to the shared `DatabaseConnection` \u2014 no SQLite/Postgres
//! branching.
//!
//! The public surface returns the same [`crate::db::models`] struct shapes
//! that the rest of the codebase already consumes, so API handlers don't
//! need to change beyond swapping their `queries::foo` calls for
//! `repo::users::foo`.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};

use crate::db::entity;
use crate::db::models::{MusicFolder, User, UserPreferences};
use crate::db::Database;
use crate::error::Result;

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

impl From<entity::users::Model> for User {
    fn from(m: entity::users::Model) -> Self {
        Self {
            id: m.id,
            username: m.username,
            password_hash: m.password_hash,
            email: m.email,
            is_admin: m.is_admin,
            created_at: m.created_at.with_timezone(&Utc),
            subsonic_token: m.subsonic_token,
        }
    }
}

impl From<entity::music_folders::Model> for MusicFolder {
    fn from(m: entity::music_folders::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            path: m.path,
            enabled: m.enabled,
            watch_enabled: m.watch_enabled,
            last_scanned_at: m.last_scanned_at.map(|t| t.with_timezone(&Utc)),
            scan_error: m.scan_error,
        }
    }
}

impl From<entity::user_preferences::Model> for UserPreferences {
    fn from(m: entity::user_preferences::Model) -> Self {
        Self {
            user_id: m.user_id,
            accent_color: m.accent_color,
            custom_accent_hue: m.custom_accent_hue,
            custom_accent_lightness: m.custom_accent_lightness,
            custom_accent_chroma: m.custom_accent_chroma,
            preferences_json: m.preferences_json,
            updated_at: m.updated_at.with_timezone(&Utc),
        }
    }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

pub async fn count_users(database: &Database) -> Result<i64> {
    let n = entity::users::Entity::find().count(database.conn()).await?;
    Ok(n as i64)
}

pub async fn get_user_by_username(database: &Database, username: &str) -> Result<Option<User>> {
    let model = entity::users::Entity::find()
        .filter(entity::users::Column::Username.eq(username))
        .one(database.conn())
        .await?;
    Ok(model.map(User::from))
}

pub async fn get_user_by_api_key(database: &Database, token: &str) -> Result<Option<User>> {
    // `api_keys -> users` via the `user_id` FK.
    let model = entity::users::Entity::find()
        .inner_join(entity::api_keys::Entity)
        .filter(entity::api_keys::Column::Token.eq(token))
        .one(database.conn())
        .await?;
    Ok(model.map(User::from))
}

pub async fn get_user_ids(database: &Database) -> Result<Vec<i64>> {
    let rows = entity::users::Entity::find()
        .select_only()
        .column(entity::users::Column::Id)
        .order_by_asc(entity::users::Column::Id)
        .into_tuple::<i64>()
        .all(database.conn())
        .await?;
    Ok(rows)
}

pub async fn create_user(
    database: &Database,
    username: &str,
    password_hash: &str,
    subsonic_token: &str,
    email: Option<&str>,
    is_admin: bool,
) -> Result<i64> {
    let now = Utc::now().fixed_offset();
    let inserted = entity::users::ActiveModel {
        username: Set(username.to_string()),
        password_hash: Set(password_hash.to_string()),
        subsonic_token: Set(Some(subsonic_token.to_string())),
        email: Set(email.map(str::to_string)),
        is_admin: Set(is_admin),
        created_at: Set(now),
        ..Default::default()
    }
    .insert(database.conn())
    .await?;
    Ok(inserted.id)
}

pub async fn update_user_password(
    database: &Database,
    username: &str,
    password_hash: &str,
    subsonic_token: &str,
) -> Result<bool> {
    let result = entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::PasswordHash,
            sea_orm::sea_query::Expr::value(password_hash.to_string()),
        )
        .col_expr(
            entity::users::Column::SubsonicToken,
            sea_orm::sea_query::Expr::value(subsonic_token.to_string()),
        )
        .filter(entity::users::Column::Username.eq(username))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

// ---------------------------------------------------------------------------
// User preferences
// ---------------------------------------------------------------------------

pub async fn get_user_preferences(
    database: &Database,
    user_id: i64,
) -> Result<Option<UserPreferences>> {
    let model = entity::user_preferences::Entity::find_by_id(user_id)
        .one(database.conn())
        .await?;
    Ok(model.map(UserPreferences::from))
}

pub async fn upsert_user_preferences(
    database: &Database,
    user_id: i64,
    accent_color: &str,
    custom_accent_hue: Option<f64>,
    custom_accent_lightness: Option<f64>,
    custom_accent_chroma: Option<f64>,
    preferences_json: &str,
) -> Result<()> {
    use sea_orm::sea_query::OnConflict;

    let now = Utc::now().fixed_offset();
    let model = entity::user_preferences::ActiveModel {
        user_id: Set(user_id),
        accent_color: Set(accent_color.to_string()),
        custom_accent_hue: Set(custom_accent_hue),
        custom_accent_lightness: Set(custom_accent_lightness),
        custom_accent_chroma: Set(custom_accent_chroma),
        preferences_json: Set(preferences_json.to_string()),
        updated_at: Set(now),
    };

    entity::user_preferences::Entity::insert(model)
        .on_conflict(
            OnConflict::column(entity::user_preferences::Column::UserId)
                .update_columns([
                    entity::user_preferences::Column::AccentColor,
                    entity::user_preferences::Column::CustomAccentHue,
                    entity::user_preferences::Column::CustomAccentLightness,
                    entity::user_preferences::Column::CustomAccentChroma,
                    entity::user_preferences::Column::PreferencesJson,
                    entity::user_preferences::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(database.conn())
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Music folders
// ---------------------------------------------------------------------------

pub async fn get_music_folders(database: &Database) -> Result<Vec<MusicFolder>> {
    let rows = entity::music_folders::Entity::find()
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .order_by_asc(entity::music_folders::Column::Id)
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().map(MusicFolder::from).collect())
}

pub async fn get_music_folders_for_user(
    database: &Database,
    user_id: i64,
) -> Result<Vec<MusicFolder>> {
    let rows = entity::music_folders::Entity::find()
        .inner_join(entity::user_library_access::Entity)
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .order_by_asc(entity::music_folders::Column::Id)
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().map(MusicFolder::from).collect())
}

pub async fn create_music_folder(database: &Database, name: &str, path: &str) -> Result<i64> {
    let inserted = entity::music_folders::ActiveModel {
        name: Set(name.to_string()),
        path: Set(path.to_string()),
        enabled: Set(true),
        ..Default::default()
    }
    .insert(database.conn())
    .await?;
    Ok(inserted.id)
}

pub async fn get_music_folder_id_by_path(database: &Database, path: &str) -> Result<Option<i64>> {
    let row = entity::music_folders::Entity::find()
        .select_only()
        .column(entity::music_folders::Column::Id)
        .filter(entity::music_folders::Column::Path.eq(path))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?;
    Ok(row)
}

pub async fn get_music_folder_ids(database: &Database) -> Result<Vec<i64>> {
    let rows = entity::music_folders::Entity::find()
        .select_only()
        .column(entity::music_folders::Column::Id)
        .order_by_asc(entity::music_folders::Column::Id)
        .into_tuple::<i64>()
        .all(database.conn())
        .await?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// User library access
// ---------------------------------------------------------------------------

pub async fn grant_user_library_access(
    database: &Database,
    user_id: i64,
    music_folder_id: i64,
) -> Result<()> {
    use sea_orm::sea_query::OnConflict;

    let model = entity::user_library_access::ActiveModel {
        user_id: Set(user_id),
        music_folder_id: Set(music_folder_id),
        created_at: Set(Utc::now().fixed_offset()),
    };

    entity::user_library_access::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                entity::user_library_access::Column::UserId,
                entity::user_library_access::Column::MusicFolderId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .do_nothing()
        .exec(database.conn())
        .await?;
    Ok(())
}
