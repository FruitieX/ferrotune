use chrono::{DateTime, Duration, Utc};
use rand::{rngs::OsRng, RngCore};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::{
    db::{entity, models::User, Database},
    error::{Error, Result},
};

const SESSION_TOKEN_BYTES: usize = 32;
const URL_TOKEN_BYTES: usize = 32;
const URL_TOKEN_ALL_SCOPE: &str = "all";

#[derive(Debug, Clone)]
pub struct CreatedAuthSession {
    pub session_id: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CreatedUrlToken {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedSession {
    pub session_id: String,
    pub user: User,
}

pub fn hash_auth_token(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

pub async fn create_session(
    database: &Database,
    user_id: i64,
    client_name: Option<&str>,
    duration: Duration,
) -> Result<CreatedAuthSession> {
    let now = Utc::now();
    let expires_at = now + duration;
    let session_id = Uuid::new_v4().to_string();
    let token = generate_token("fts", SESSION_TOKEN_BYTES);
    let token_hash = hash_auth_token(&token);

    let model = entity::auth_sessions::ActiveModel {
        id: Set(session_id.clone()),
        token_hash: Set(token_hash),
        user_id: Set(user_id),
        client_name: Set(client_name.map(str::to_string)),
        created_at: Set(now.fixed_offset()),
        last_used_at: Set(Some(now.fixed_offset())),
        expires_at: Set(expires_at.fixed_offset()),
        revoked_at: Set(None),
    };

    entity::auth_sessions::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(CreatedAuthSession {
        session_id,
        token,
        expires_at,
    })
}

pub async fn authenticate_session_token(
    database: &Database,
    token: &str,
) -> Result<Option<AuthenticatedSession>> {
    let token_hash = hash_auth_token(token);
    let now = Utc::now();
    let Some(session) = entity::auth_sessions::Entity::find()
        .filter(entity::auth_sessions::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .filter(entity::auth_sessions::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    touch_session(database, &session.id, now).await?;

    let Some(user) = super::users::get_user_by_id(database, session.user_id).await? else {
        return Ok(None);
    };

    Ok(Some(AuthenticatedSession {
        session_id: session.id,
        user,
    }))
}

pub async fn revoke_session_token(database: &Database, token: &str) -> Result<()> {
    let token_hash = hash_auth_token(token);
    let now = Utc::now().fixed_offset();

    entity::auth_sessions::Entity::update_many()
        .col_expr(
            entity::auth_sessions::Column::RevokedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(entity::auth_sessions::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn create_url_token(
    database: &Database,
    session_id: &str,
    user_id: i64,
    scope: &str,
    duration: Duration,
) -> Result<CreatedUrlToken> {
    let normalized_scope = normalize_url_token_scope(scope)?;
    let now = Utc::now();
    let expires_at = now + duration;
    let token = generate_token("ftu", URL_TOKEN_BYTES);
    let token_hash = hash_auth_token(&token);

    let model = entity::auth_url_tokens::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        token_hash: Set(token_hash),
        session_id: Set(session_id.to_string()),
        user_id: Set(user_id),
        scope: Set(normalized_scope),
        created_at: Set(now.fixed_offset()),
        expires_at: Set(expires_at.fixed_offset()),
    };

    entity::auth_url_tokens::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(CreatedUrlToken { token, expires_at })
}

pub async fn authenticate_url_token(
    database: &Database,
    token: &str,
    required_scope: &str,
) -> Result<Option<AuthenticatedSession>> {
    let required_scope = normalize_url_token_scope(required_scope)?;
    let token_hash = hash_auth_token(token);
    let now = Utc::now();

    let Some(url_token) = entity::auth_url_tokens::Entity::find()
        .filter(entity::auth_url_tokens::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_url_tokens::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    if url_token.scope != URL_TOKEN_ALL_SCOPE && url_token.scope != required_scope {
        return Ok(None);
    }

    let Some(session) = entity::auth_sessions::Entity::find()
        .filter(entity::auth_sessions::Column::Id.eq(url_token.session_id))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .filter(entity::auth_sessions::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    touch_session(database, &session.id, now).await?;

    let Some(user) = super::users::get_user_by_id(database, session.user_id).await? else {
        return Ok(None);
    };

    Ok(Some(AuthenticatedSession {
        session_id: session.id,
        user,
    }))
}

fn normalize_url_token_scope(scope: &str) -> Result<String> {
    let normalized = scope.trim().to_ascii_lowercase();
    match normalized.as_str() {
        URL_TOKEN_ALL_SCOPE | "media" | "events" => Ok(normalized),
        _ => Err(Error::InvalidRequest(format!(
            "Unsupported URL token scope: {scope}"
        ))),
    }
}

async fn touch_session(database: &Database, session_id: &str, now: DateTime<Utc>) -> Result<()> {
    entity::auth_sessions::Entity::update_many()
        .col_expr(
            entity::auth_sessions::Column::LastUsedAt,
            sea_orm::sea_query::Expr::value(now.fixed_offset()),
        )
        .filter(entity::auth_sessions::Column::Id.eq(session_id))
        .exec(database.conn())
        .await?;

    Ok(())
}

fn generate_token(prefix: &str, bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    format!("{prefix}_{}", hex::encode(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::users;

    #[tokio::test]
    async fn session_and_url_tokens_authenticate_and_revoke() {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("in-memory database should migrate");
        let user_id = users::create_user(
            &database,
            "session-user",
            "password-hash",
            Some("session@example.com"),
            true,
        )
        .await
        .expect("user should be created");

        let session = create_session(
            &database,
            user_id,
            Some("test-client"),
            Duration::minutes(10),
        )
        .await
        .expect("session should be created");

        assert_ne!(session.token, hash_auth_token(&session.token));
        let authenticated = authenticate_session_token(&database, &session.token)
            .await
            .expect("session auth should query")
            .expect("session token should authenticate");
        assert_eq!(authenticated.user.id, user_id);
        assert_eq!(authenticated.user.username, "session-user");

        let url_token = create_url_token(
            &database,
            &session.session_id,
            user_id,
            "media",
            Duration::minutes(5),
        )
        .await
        .expect("URL token should be created");

        let media_user = authenticate_url_token(&database, &url_token.token, "media")
            .await
            .expect("URL-token auth should query")
            .expect("matching URL-token scope should authenticate");
        assert_eq!(media_user.user.id, user_id);

        let events_user = authenticate_url_token(&database, &url_token.token, "events")
            .await
            .expect("URL-token auth should query");
        assert!(events_user.is_none());

        revoke_session_token(&database, &session.token)
            .await
            .expect("session should be revoked");
        let revoked_session = authenticate_session_token(&database, &session.token)
            .await
            .expect("revoked session auth should query");
        assert!(revoked_session.is_none());
        let revoked_url_token = authenticate_url_token(&database, &url_token.token, "media")
            .await
            .expect("revoked URL-token auth should query");
        assert!(revoked_url_token.is_none());
    }
}
