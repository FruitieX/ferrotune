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
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, FromQueryResult, Order,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};

use crate::db::entity;
use crate::db::models::{MusicFolder, User, UserPreferences};
use crate::db::ordering::case_insensitive_order;
use crate::db::Database;
use crate::error::Result;

#[derive(Debug, FromQueryResult)]
struct ShareableUserRow {
    id: i64,
    username: String,
}

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

pub async fn count_music_folders(database: &Database) -> Result<i64> {
    let n = entity::music_folders::Entity::find()
        .count(database.conn())
        .await?;
    Ok(n as i64)
}

pub async fn get_user_by_id(database: &Database, user_id: i64) -> Result<Option<User>> {
    let model = entity::users::Entity::find_by_id(user_id)
        .one(database.conn())
        .await?;
    Ok(model.map(User::from))
}

pub async fn list_users(database: &Database) -> Result<Vec<User>> {
    let rows = entity::users::Entity::find()
        .order_by_asc(entity::users::Column::Id)
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().map(User::from).collect())
}

pub async fn list_shareable_users(
    database: &Database,
    exclude_user_id: i64,
) -> Result<Vec<(i64, String)>> {
    let rows = entity::users::Entity::find()
        .select_only()
        .column(entity::users::Column::Id)
        .column(entity::users::Column::Username)
        .filter(entity::users::Column::Id.ne(exclude_user_id))
        .order_by(
            case_insensitive_order(database.sea_backend(), entity::users::Column::Username),
            Order::Asc,
        )
        .order_by_asc(entity::users::Column::Username)
        .into_model::<ShareableUserRow>()
        .all(database.conn())
        .await?;
    Ok(rows.into_iter().map(|row| (row.id, row.username)).collect())
}

pub async fn user_exists(database: &Database, user_id: i64) -> Result<bool> {
    Ok(get_user_by_id(database, user_id).await?.is_some())
}

pub async fn username_exists(
    database: &Database,
    username: &str,
    exclude_user_id: Option<i64>,
) -> Result<bool> {
    let mut query = entity::users::Entity::find()
        .select_only()
        .column(entity::users::Column::Id)
        .filter(entity::users::Column::Username.eq(username));

    if let Some(exclude_user_id) = exclude_user_id {
        query = query.filter(entity::users::Column::Id.ne(exclude_user_id));
    }

    Ok(query
        .into_tuple::<i64>()
        .one(database.conn())
        .await?
        .is_some())
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

pub async fn update_user_username_by_id(
    database: &Database,
    user_id: i64,
    username: &str,
) -> Result<bool> {
    let result = entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::Username,
            sea_orm::sea_query::Expr::value(username.to_string()),
        )
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn update_user_password_by_id(
    database: &Database,
    user_id: i64,
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
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn update_user_email_by_id(
    database: &Database,
    user_id: i64,
    email: Option<&str>,
) -> Result<bool> {
    let result = entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::Email,
            sea_orm::sea_query::Expr::value(email.map(str::to_string)),
        )
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn update_user_admin_by_id(
    database: &Database,
    user_id: i64,
    is_admin: bool,
) -> Result<bool> {
    let result = entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::IsAdmin,
            sea_orm::sea_query::Expr::value(is_admin),
        )
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn delete_user_by_id(database: &Database, user_id: i64) -> Result<bool> {
    let result = entity::users::Entity::delete_many()
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(result.rows_affected > 0)
}

pub async fn get_lastfm_credentials(
    database: &Database,
    user_id: i64,
) -> Result<Option<(String, String, String)>> {
    let model = entity::users::Entity::find_by_id(user_id)
        .one(database.conn())
        .await?;

    Ok(match model {
        Some(model) => match (
            model.lastfm_api_key,
            model.lastfm_api_secret,
            model.lastfm_session_key,
        ) {
            (Some(api_key), Some(api_secret), Some(session_key))
                if !api_key.is_empty() && !api_secret.is_empty() =>
            {
                Some((api_key, api_secret, session_key))
            }
            _ => None,
        },
        None => None,
    })
}

pub async fn get_lastfm_config(
    database: &Database,
    user_id: i64,
) -> Result<Option<(Option<String>, Option<String>)>> {
    let model = entity::users::Entity::find_by_id(user_id)
        .one(database.conn())
        .await?;
    Ok(model.map(|row| (row.lastfm_api_key, row.lastfm_api_secret)))
}

pub async fn get_lastfm_status(
    database: &Database,
    user_id: i64,
) -> Result<Option<(Option<String>, Option<String>, Option<String>)>> {
    let model = entity::users::Entity::find_by_id(user_id)
        .one(database.conn())
        .await?;
    Ok(model.map(|row| {
        (
            row.lastfm_api_key,
            row.lastfm_session_key,
            row.lastfm_username,
        )
    }))
}

pub async fn update_lastfm_session(
    database: &Database,
    user_id: i64,
    session_key: Option<&str>,
    username: Option<&str>,
) -> Result<()> {
    entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::LastfmSessionKey,
            sea_orm::sea_query::Expr::value(session_key.map(str::to_string)),
        )
        .col_expr(
            entity::users::Column::LastfmUsername,
            sea_orm::sea_query::Expr::value(username.map(str::to_string)),
        )
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn update_lastfm_config(
    database: &Database,
    user_id: i64,
    api_key: &str,
    api_secret: &str,
) -> Result<()> {
    entity::users::Entity::update_many()
        .col_expr(
            entity::users::Column::LastfmApiKey,
            sea_orm::sea_query::Expr::value(api_key.to_string()),
        )
        .col_expr(
            entity::users::Column::LastfmApiSecret,
            sea_orm::sea_query::Expr::value(api_secret.to_string()),
        )
        .filter(entity::users::Column::Id.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(())
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

pub async fn get_enabled_accessible_music_folder_ids(
    database: &Database,
    user_id: i64,
) -> Result<Vec<i64>> {
    let rows = entity::music_folders::Entity::find()
        .inner_join(entity::user_library_access::Entity)
        .filter(entity::music_folders::Column::Enabled.eq(true))
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
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

pub async fn get_user_library_access_ids(database: &Database, user_id: i64) -> Result<Vec<i64>> {
    let rows = entity::user_library_access::Entity::find()
        .select_only()
        .column(entity::user_library_access::Column::MusicFolderId)
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .order_by_asc(entity::user_library_access::Column::MusicFolderId)
        .into_tuple::<i64>()
        .all(database.conn())
        .await?;
    Ok(rows)
}

pub async fn clear_user_library_access(database: &Database, user_id: i64) -> Result<()> {
    entity::user_library_access::Entity::delete_many()
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn replace_user_library_access(
    database: &Database,
    user_id: i64,
    folder_ids: &[i64],
) -> Result<()> {
    clear_user_library_access(database, user_id).await?;

    if folder_ids.is_empty() {
        return Ok(());
    }

    use sea_orm::sea_query::OnConflict;

    let models = folder_ids
        .iter()
        .copied()
        .map(|music_folder_id| entity::user_library_access::ActiveModel {
            user_id: Set(user_id),
            music_folder_id: Set(music_folder_id),
            created_at: Set(Utc::now().fixed_offset()),
        })
        .collect::<Vec<_>>();

    entity::user_library_access::Entity::insert_many(models)
        .on_conflict(
            OnConflict::columns([
                entity::user_library_access::Column::UserId,
                entity::user_library_access::Column::MusicFolderId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn list_api_keys(
    database: &Database,
    user_id: i64,
) -> Result<Vec<(String, chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>)>> {
    let rows = entity::api_keys::Entity::find()
        .filter(entity::api_keys::Column::UserId.eq(user_id))
        .all(database.conn())
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.name,
                row.created_at.with_timezone(&Utc),
                row.last_used.map(|value| value.with_timezone(&Utc)),
            )
        })
        .collect())
}

pub async fn create_api_key(
    database: &Database,
    token: &str,
    user_id: i64,
    name: &str,
) -> Result<()> {
    let model = entity::api_keys::ActiveModel {
        token: Set(token.to_string()),
        user_id: Set(user_id),
        name: Set(name.to_string()),
        created_at: Set(Utc::now().fixed_offset()),
        last_used: Set(None),
    };

    model.insert(database.conn()).await?;
    Ok(())
}

pub async fn api_key_exists(database: &Database, user_id: i64, name: &str) -> Result<bool> {
    Ok(entity::api_keys::Entity::find()
        .select_only()
        .column(entity::api_keys::Column::Token)
        .filter(entity::api_keys::Column::UserId.eq(user_id))
        .filter(entity::api_keys::Column::Name.eq(name))
        .into_tuple::<String>()
        .one(database.conn())
        .await?
        .is_some())
}

pub async fn delete_api_key(database: &Database, user_id: i64, name: &str) -> Result<()> {
    entity::api_keys::Entity::delete_many()
        .filter(entity::api_keys::Column::UserId.eq(user_id))
        .filter(entity::api_keys::Column::Name.eq(name))
        .exec(database.conn())
        .await?;
    Ok(())
}

pub async fn user_has_folder_access(
    database: &Database,
    user_id: i64,
    folder_id: i64,
) -> Result<bool> {
    Ok(entity::user_library_access::Entity::find()
        .select_only()
        .column(entity::user_library_access::Column::MusicFolderId)
        .filter(entity::user_library_access::Column::UserId.eq(user_id))
        .filter(entity::user_library_access::Column::MusicFolderId.eq(folder_id))
        .into_tuple::<i64>()
        .one(database.conn())
        .await?
        .is_some())
}

pub async fn user_has_song_access(
    database: &Database,
    user_id: i64,
    song_id: &str,
) -> Result<bool> {
    let folder_ids = get_user_library_access_ids(database, user_id).await?;
    if folder_ids.is_empty() {
        return Ok(false);
    }

    Ok(entity::songs::Entity::find()
        .select_only()
        .column(entity::songs::Column::Id)
        .filter(entity::songs::Column::Id.eq(song_id))
        .filter(entity::songs::Column::MusicFolderId.is_in(folder_ids))
        .into_tuple::<String>()
        .one(database.conn())
        .await?
        .is_some())
}
