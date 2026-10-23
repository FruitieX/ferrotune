//! Provider accounts (issuer + subject) linked to local users for OIDC sign-in.

use chrono::Utc;
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};

use crate::db::entity::user_oidc_identities as identities;
use crate::db::models::User;
use crate::db::Database;
use crate::error::Result;

/// The local user linked to this provider account, if any.
pub async fn find_user(database: &Database, issuer: &str, subject: &str) -> Result<Option<User>> {
    let Some(identity) = identities::Entity::find_by_id((issuer.to_string(), subject.to_string()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };
    super::users::get_user_by_id(database, identity.user_id).await
}

/// Whether the user already has an account at this issuer linked.
pub async fn user_has_identity(database: &Database, issuer: &str, user_id: i64) -> Result<bool> {
    Ok(identities::Entity::find()
        .filter(identities::Column::Issuer.eq(issuer))
        .filter(identities::Column::UserId.eq(user_id))
        .one(database.conn())
        .await?
        .is_some())
}

pub async fn link(database: &Database, issuer: &str, subject: &str, user_id: i64) -> Result<()> {
    let now = Utc::now().fixed_offset();
    identities::Entity::insert(identities::ActiveModel {
        issuer: Set(issuer.to_string()),
        subject: Set(subject.to_string()),
        user_id: Set(user_id),
        created_at: Set(now),
        last_login_at: Set(Some(now)),
    })
    .exec(database.conn())
    .await?;
    Ok(())
}

pub async fn touch_login(database: &Database, issuer: &str, subject: &str) -> Result<()> {
    identities::Entity::update_many()
        .col_expr(
            identities::Column::LastLoginAt,
            sea_orm::sea_query::Expr::value(Utc::now().fixed_offset()),
        )
        .filter(identities::Column::Issuer.eq(issuer))
        .filter(identities::Column::Subject.eq(subject))
        .exec(database.conn())
        .await?;
    Ok(())
}
